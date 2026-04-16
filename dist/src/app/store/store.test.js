import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
// Mock ./db.js so every module gets an in-memory SQLite database
vi.mock("./db.js", async () => {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    return {
        getDb: () => db,
        closeDb: () => { },
    };
});
// All imports below receive the mocked db (vi.mock is hoisted)
import { getDb } from "./db.js";
import { runMigrations } from "./migrations.js";
import "./migrations/v001-initial-tables.js";
import * as incidents from "./incidents.js";
import * as outbox from "./outbox.js";
import * as operatorCommands from "./operatorCommands.js";
import * as pluginState from "./pluginState.js";
import * as approvals from "./approvals.js";
import * as audit from "./audit.js";
import * as scheduleRuns from "./scheduleRuns.js";
beforeAll(() => {
    runMigrations();
});
afterAll(() => {
    getDb().close();
});
// Delete in FK-safe order: children before parents
function cleanTables() {
    const db = getDb();
    for (const table of [
        "incident_events",
        "approval_decisions",
        "operator_commands",
        "notifications_outbox",
        "incidents",
        "plugin_state",
        "schedule_runs",
        "audit_events",
        "idempotency_keys",
    ]) {
        db.prepare(`DELETE FROM ${table}`).run();
    }
}
/* ------------------------------------------------------------------ */
/*  Migrations                                                        */
/* ------------------------------------------------------------------ */
describe("migrations", () => {
    it("should create all expected tables", () => {
        const rows = getDb()
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all();
        const names = rows.map((r) => r.name);
        for (const table of [
            "incidents",
            "incident_events",
            "notifications_outbox",
            "operator_commands",
            "approval_decisions",
            "plugin_state",
            "schedule_runs",
            "audit_events",
            "idempotency_keys",
            "migrations",
        ]) {
            expect(names).toContain(table);
        }
    });
    it("should be idempotent", () => {
        expect(() => runMigrations()).not.toThrow();
    });
});
/* ------------------------------------------------------------------ */
/*  Incidents                                                         */
/* ------------------------------------------------------------------ */
describe("incidents", () => {
    beforeEach(() => cleanTables());
    it("should create and retrieve an incident", () => {
        const inc = incidents.createIncident({
            id: "inc-001",
            source: "alertmanager",
            title: "High CPU on web-1",
            severity: "critical",
            service_name: "web-1",
        });
        expect(inc.id).toBe("inc-001");
        expect(inc.status).toBe("open");
        expect(inc.severity).toBe("critical");
        const fetched = incidents.getIncident("inc-001");
        expect(fetched).not.toBeNull();
        expect(fetched.title).toBe("High CPU on web-1");
        expect(fetched.service_name).toBe("web-1");
    });
    it("should return null for a missing incident", () => {
        expect(incidents.getIncident("nonexistent")).toBeNull();
    });
    it("should default severity to warning", () => {
        const inc = incidents.createIncident({
            id: "inc-def",
            source: "manual",
            title: "No severity specified",
        });
        expect(inc.severity).toBe("warning");
    });
    it("should store and parse metadata JSON", () => {
        const meta = { host: "web-1", region: "us-east-1" };
        incidents.createIncident({
            id: "inc-meta",
            source: "manual",
            title: "With metadata",
            metadata: meta,
        });
        const fetched = incidents.getIncident("inc-meta");
        expect(fetched.metadata).toEqual(meta);
    });
    it("should dedupe by source_id", () => {
        incidents.createIncident({
            id: "inc-002",
            source: "alertmanager",
            source_id: "alert-xyz",
            title: "Test alert",
        });
        const found = incidents.findBySourceId("alertmanager", "alert-xyz");
        expect(found).not.toBeNull();
        expect(found.id).toBe("inc-002");
        expect(incidents.findBySourceId("grafana", "alert-xyz")).toBeNull();
        expect(incidents.findBySourceId("alertmanager", "other")).toBeNull();
    });
    it("should update status", () => {
        incidents.createIncident({ id: "inc-003", source: "manual", title: "Test" });
        incidents.updateStatus("inc-003", "acknowledged");
        expect(incidents.getIncident("inc-003").status).toBe("acknowledged");
    });
    it("should set resolved_at when resolving", () => {
        incidents.createIncident({ id: "inc-004", source: "manual", title: "Test" });
        incidents.updateStatus("inc-004", "resolved");
        const resolved = incidents.getIncident("inc-004");
        expect(resolved.status).toBe("resolved");
        expect(resolved.resolved_at).not.toBeNull();
    });
    it("should set resolved_at when closing", () => {
        incidents.createIncident({ id: "inc-close", source: "manual", title: "Test" });
        incidents.updateStatus("inc-close", "closed");
        expect(incidents.getIncident("inc-close").resolved_at).not.toBeNull();
    });
    it("should list by status", () => {
        incidents.createIncident({ id: "inc-005", source: "manual", title: "Open one" });
        incidents.createIncident({ id: "inc-006", source: "manual", title: "Another" });
        incidents.updateStatus("inc-006", "resolved");
        expect(incidents.listIncidents("open")).toHaveLength(1);
        expect(incidents.listIncidents("open")[0].id).toBe("inc-005");
        expect(incidents.listIncidents("resolved")).toHaveLength(1);
        expect(incidents.listIncidents()).toHaveLength(2);
    });
    it("should set thread id", () => {
        incidents.createIncident({ id: "inc-thread", source: "manual", title: "Thread test" });
        incidents.setThreadId("inc-thread", "thread-abc");
        expect(incidents.getIncident("inc-thread").thread_id).toBe("thread-abc");
    });
});
/* ------------------------------------------------------------------ */
/*  Outbox                                                            */
/* ------------------------------------------------------------------ */
describe("outbox", () => {
    beforeEach(() => cleanTables());
    it("should insert and claim messages", () => {
        outbox.insertOutboxMessage({
            channel_id: "ch-001",
            message_type: "alert",
            payload: { content: "Server down!" },
        });
        const claimed = outbox.claimPending(5);
        expect(claimed).toHaveLength(1);
        expect(claimed[0].status).toBe("claimed");
        expect(claimed[0].channel_id).toBe("ch-001");
        expect(claimed[0].payload).toEqual({ content: "Server down!" });
        expect(claimed[0].attempts).toBe(1);
        // Second claim returns nothing
        expect(outbox.claimPending(5)).toHaveLength(0);
    });
    it("should mark delivered", () => {
        const id = outbox.insertOutboxMessage({
            channel_id: "ch-002",
            message_type: "report",
            payload: { content: "Daily report" },
        });
        outbox.claimPending(5);
        outbox.markDelivered(id);
        expect(outbox.claimPending(5)).toHaveLength(0);
    });
    it("should respect claim limit", () => {
        for (let i = 0; i < 5; i++) {
            outbox.insertOutboxMessage({
                channel_id: "ch-bulk",
                message_type: "alert",
                payload: { idx: i },
            });
        }
        expect(outbox.claimPending(3)).toHaveLength(3);
        expect(outbox.claimPending(10)).toHaveLength(2);
    });
    it("should retry failed messages up to max_attempts", () => {
        const id = outbox.insertOutboxMessage({
            channel_id: "ch-003",
            message_type: "alert",
            payload: { content: "Retry test" },
            max_attempts: 2,
        });
        // First attempt — claim then fail
        outbox.claimPending(5);
        outbox.markFailed(id, "Network error");
        // Should be back to pending
        const retry = outbox.claimPending(5);
        expect(retry).toHaveLength(1);
        // Second attempt fails — permanently failed
        outbox.markFailed(id, "Network error again");
        expect(outbox.claimPending(5)).toHaveLength(0);
    });
    it("should set thread id on a message", () => {
        const id = outbox.insertOutboxMessage({
            channel_id: "ch-thr",
            message_type: "alert",
            payload: { x: 1 },
        });
        outbox.setThreadId(id, "thread-xyz");
        const row = getDb()
            .prepare("SELECT thread_id FROM notifications_outbox WHERE id = ?")
            .get(id);
        expect(row.thread_id).toBe("thread-xyz");
    });
    it("should default max_attempts to 3", () => {
        const id = outbox.insertOutboxMessage({
            channel_id: "ch-def",
            message_type: "alert",
            payload: {},
        });
        const row = getDb()
            .prepare("SELECT max_attempts FROM notifications_outbox WHERE id = ?")
            .get(id);
        expect(row.max_attempts).toBe(3);
    });
});
/* ------------------------------------------------------------------ */
/*  Operator commands                                                 */
/* ------------------------------------------------------------------ */
describe("operator commands", () => {
    beforeEach(() => cleanTables());
    it("should insert and claim commands", () => {
        operatorCommands.insertCommand({
            command_type: "ack",
            actor: "user:123",
        });
        const claimed = operatorCommands.claimPending(5);
        expect(claimed).toHaveLength(1);
        expect(claimed[0].command_type).toBe("ack");
        expect(claimed[0].actor).toBe("user:123");
        expect(claimed[0].status).toBe("claimed");
    });
    it("should mark executed", () => {
        const id = operatorCommands.insertCommand({
            command_type: "note",
            actor: "user:456",
            payload: { text: "Looking into it" },
        });
        operatorCommands.claimPending(5);
        operatorCommands.markExecuted(id, "Done");
        expect(operatorCommands.claimPending(5)).toHaveLength(0);
    });
    it("should mark failed", () => {
        const id = operatorCommands.insertCommand({
            command_type: "restart",
            actor: "user:789",
        });
        operatorCommands.claimPending(5);
        operatorCommands.markFailed(id, "Permission denied");
        expect(operatorCommands.claimPending(5)).toHaveLength(0);
    });
    it("should store and parse payload JSON", () => {
        operatorCommands.insertCommand({
            command_type: "scale",
            actor: "user:ops",
            payload: { replicas: 3 },
        });
        const claimed = operatorCommands.claimPending(1);
        expect(claimed[0].payload).toEqual({ replicas: 3 });
    });
    it("should allow null incident_id", () => {
        const id = operatorCommands.insertCommand({
            command_type: "ping",
            actor: "user:test",
        });
        const row = getDb()
            .prepare("SELECT incident_id FROM operator_commands WHERE id = ?")
            .get(id);
        expect(row.incident_id).toBeNull();
    });
});
/* ------------------------------------------------------------------ */
/*  Plugin state                                                      */
/* ------------------------------------------------------------------ */
describe("plugin state", () => {
    beforeEach(() => cleanTables());
    it("should get/set state", () => {
        pluginState.setState("chat-core", "last_run", "2024-01-01");
        expect(pluginState.getState("chat-core", "last_run")).toBe("2024-01-01");
    });
    it("should overwrite existing state (upsert)", () => {
        pluginState.setState("chat-core", "counter", "1");
        pluginState.setState("chat-core", "counter", "2");
        expect(pluginState.getState("chat-core", "counter")).toBe("2");
    });
    it("should return null for missing state", () => {
        expect(pluginState.getState("missing", "key")).toBeNull();
    });
    it("should get all state for a plugin", () => {
        pluginState.setState("test-plugin", "a", "1");
        pluginState.setState("test-plugin", "b", "2");
        expect(pluginState.getAllState("test-plugin")).toEqual({ a: "1", b: "2" });
    });
    it("should isolate state between plugins", () => {
        pluginState.setState("plugin-a", "key", "A");
        pluginState.setState("plugin-b", "key", "B");
        expect(pluginState.getState("plugin-a", "key")).toBe("A");
        expect(pluginState.getState("plugin-b", "key")).toBe("B");
        expect(pluginState.getAllState("plugin-a")).toEqual({ key: "A" });
    });
    it("should delete state", () => {
        pluginState.setState("test-plugin", "temp", "val");
        pluginState.deleteState("test-plugin", "temp");
        expect(pluginState.getState("test-plugin", "temp")).toBeNull();
    });
});
/* ------------------------------------------------------------------ */
/*  Approvals                                                         */
/* ------------------------------------------------------------------ */
describe("approvals", () => {
    beforeEach(() => cleanTables());
    it("should request and decide an approval", () => {
        const id = approvals.requestApproval({
            action_name: "deploy",
            requested_by: "bot",
        });
        expect(id).toBeGreaterThan(0);
        approvals.decide(id, {
            decided_by: "admin",
            decision: "approved",
            reason: "LGTM",
        });
        const decision = approvals.getDecision(id);
        expect(decision).not.toBeNull();
        expect(decision.decision).toBe("approved");
        expect(decision.decided_by).toBe("admin");
        expect(decision.reason).toBe("LGTM");
        expect(decision.decided_at).not.toBeNull();
    });
    it("should list pending approvals", () => {
        approvals.requestApproval({ action_name: "a1", requested_by: "bot" });
        approvals.requestApproval({ action_name: "a2", requested_by: "bot" });
        const id3 = approvals.requestApproval({ action_name: "a3", requested_by: "bot" });
        approvals.decide(id3, { decided_by: "admin", decision: "denied" });
        const pending = approvals.getPending();
        expect(pending).toHaveLength(2);
    });
    it("should filter pending by incident_id", () => {
        incidents.createIncident({ id: "inc-appr", source: "manual", title: "Approval test" });
        approvals.requestApproval({ incident_id: "inc-appr", action_name: "restart", requested_by: "bot" });
        approvals.requestApproval({ action_name: "other", requested_by: "bot" });
        expect(approvals.getPending("inc-appr")).toHaveLength(1);
        expect(approvals.getPending("inc-appr")[0].action_name).toBe("restart");
    });
});
/* ------------------------------------------------------------------ */
/*  Audit                                                             */
/* ------------------------------------------------------------------ */
describe("audit", () => {
    beforeEach(() => cleanTables());
    it("should log and query audit events", () => {
        audit.logAudit({
            process: "bot",
            event_type: "command_received",
            actor: "user:100",
            detail: { command: "/ack" },
        });
        audit.logAudit({
            process: "worker",
            event_type: "job_complete",
            target: "inc-001",
        });
        const all = audit.queryAudit({});
        expect(all).toHaveLength(2);
        const byType = audit.queryAudit({ eventType: "command_received" });
        expect(byType).toHaveLength(1);
        expect(byType[0].detail).toEqual({ command: "/ack" });
        const byActor = audit.queryAudit({ actor: "user:100" });
        expect(byActor).toHaveLength(1);
    });
    it("should respect query limit", () => {
        for (let i = 0; i < 5; i++) {
            audit.logAudit({ process: "test", event_type: "tick" });
        }
        expect(audit.queryAudit({ limit: 3 })).toHaveLength(3);
    });
});
/* ------------------------------------------------------------------ */
/*  Schedule runs                                                     */
/* ------------------------------------------------------------------ */
describe("schedule runs", () => {
    beforeEach(() => cleanTables());
    it("should track a run through its lifecycle", () => {
        const id = scheduleRuns.insertRun("heartbeat", "every-5m");
        expect(id).toBeGreaterThan(0);
        scheduleRuns.startRun(id);
        expect(scheduleRuns.isRunning("heartbeat", "every-5m")).toBe(true);
        scheduleRuns.completeRun(id, "OK");
        expect(scheduleRuns.isRunning("heartbeat", "every-5m")).toBe(false);
        const last = scheduleRuns.getLastRun("heartbeat", "every-5m");
        expect(last).not.toBeNull();
        expect(last.status).toBe("completed");
        expect(last.result).toBe("OK");
    });
    it("should record a failed run", () => {
        const id = scheduleRuns.insertRun("cleanup", "daily");
        scheduleRuns.startRun(id);
        scheduleRuns.failRun(id, "Timeout");
        const last = scheduleRuns.getLastRun("cleanup", "daily");
        expect(last.status).toBe("failed");
        expect(last.error).toBe("Timeout");
    });
    it("should return null when no runs exist", () => {
        expect(scheduleRuns.getLastRun("nope", "nope")).toBeNull();
    });
});
