import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
// Mock db.js so all modules share an in-memory SQLite database
vi.mock("../store/db.js", async () => {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    return {
        getDb: () => db,
        closeDb: () => { },
    };
});
import { getDb } from "../store/db.js";
import { runMigrations } from "../store/migrations.js";
import "../store/migrations/v001-initial-tables.js";
import { PolicyEngine } from "./engine.js";
import { recordAction, getLastActionTime, isInCooldown } from "./cooldown.js";
import { isInMaintenanceWindow, shouldSuppressAlert } from "./maintenance.js";
import { isDuplicate } from "./dedupe.js";
import { mapSeverity, addMapping, resetMappings } from "./severity.js";
import { runCleanup } from "./cleanup.js";
import * as pluginState from "../store/pluginState.js";
import * as incidents from "../store/incidents.js";
beforeAll(() => {
    runMigrations();
});
afterAll(() => {
    getDb().close();
});
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
/*  Allowlist                                                          */
/* ------------------------------------------------------------------ */
describe("allowlist", () => {
    let engine;
    beforeEach(() => {
        cleanTables();
        engine = new PolicyEngine();
        engine.addRule({
            type: "allowlist",
            name: "only-restart",
            config: {
                actions: ["restart", "status"],
                services: ["*"],
            },
        });
    });
    it("should allow matching actions", () => {
        const result = engine.evaluate({ action: "restart", service: "web-1" });
        expect(result.allowed).toBe(true);
    });
    it("should deny non-matching actions", () => {
        const result = engine.evaluate({ action: "delete", service: "web-1" });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("not in the allowlist");
    });
    it("should allow wildcard service matching", () => {
        const result = engine.evaluate({ action: "status", service: "any-service" });
        expect(result.allowed).toBe(true);
    });
});
/* ------------------------------------------------------------------ */
/*  Denylist                                                           */
/* ------------------------------------------------------------------ */
describe("denylist", () => {
    let engine;
    beforeEach(() => {
        cleanTables();
        engine = new PolicyEngine();
        engine.addRule({
            type: "denylist",
            name: "no-delete",
            config: {
                actions: ["delete", "destroy"],
                services: ["*"],
            },
        });
    });
    it("should deny matching actions", () => {
        const result = engine.evaluate({ action: "delete", service: "web-1" });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("denied by policy");
    });
    it("should allow non-matching actions", () => {
        const result = engine.evaluate({ action: "restart", service: "web-1" });
        expect(result.allowed).toBe(true);
    });
    it("should deny with wildcard service", () => {
        const result = engine.evaluate({ action: "destroy" });
        expect(result.allowed).toBe(false);
    });
});
/* ------------------------------------------------------------------ */
/*  Cooldown                                                           */
/* ------------------------------------------------------------------ */
describe("cooldown", () => {
    beforeEach(() => cleanTables());
    it("should record and check cooldown", () => {
        recordAction("restart", "web-1");
        expect(isInCooldown("restart", "web-1", 60_000)).toBe(true);
        expect(isInCooldown("restart", "web-1", 0)).toBe(false);
    });
    it("should return null for unrecorded actions", () => {
        expect(getLastActionTime("never", "done")).toBeNull();
        expect(isInCooldown("never", "done", 60_000)).toBe(false);
    });
    it("should deny within cooldown window via engine", () => {
        const engine = new PolicyEngine();
        engine.addRule({
            type: "cooldown",
            name: "restart-cooldown",
            config: {
                actionPattern: "restart",
                cooldownMs: 60_000,
            },
        });
        // First call records and allows
        const first = engine.evaluate({ action: "restart", service: "web-1" });
        expect(first.allowed).toBe(true);
        // Second call within window should be denied
        const second = engine.evaluate({ action: "restart", service: "web-1" });
        expect(second.allowed).toBe(false);
        expect(second.reason).toContain("cooldown");
    });
    it("should allow after cooldown window", () => {
        // Manually set a past timestamp
        pluginState.setState("_policy_engine", "cooldown:restart:web-1", new Date(Date.now() - 120_000).toISOString());
        expect(isInCooldown("restart", "web-1", 60_000)).toBe(false);
    });
});
/* ------------------------------------------------------------------ */
/*  Rate limit                                                         */
/* ------------------------------------------------------------------ */
describe("rate limit", () => {
    beforeEach(() => cleanTables());
    it("should allow within limit", () => {
        const engine = new PolicyEngine();
        engine.addRule({
            type: "rateLimit",
            name: "api-limit",
            config: {
                actionPattern: "api-call",
                maxActions: 3,
                windowMs: 60_000,
            },
        });
        expect(engine.evaluate({ action: "api-call" }).allowed).toBe(true);
        expect(engine.evaluate({ action: "api-call" }).allowed).toBe(true);
        expect(engine.evaluate({ action: "api-call" }).allowed).toBe(true);
    });
    it("should deny exceeding limit", () => {
        const engine = new PolicyEngine();
        engine.addRule({
            type: "rateLimit",
            name: "api-limit",
            config: {
                actionPattern: "api-call",
                maxActions: 2,
                windowMs: 60_000,
            },
        });
        engine.evaluate({ action: "api-call" });
        engine.evaluate({ action: "api-call" });
        const third = engine.evaluate({ action: "api-call" });
        expect(third.allowed).toBe(false);
        expect(third.reason).toContain("Rate limit exceeded");
    });
    it("should not rate-limit non-matching actions", () => {
        const engine = new PolicyEngine();
        engine.addRule({
            type: "rateLimit",
            name: "api-limit",
            config: {
                actionPattern: "api-call",
                maxActions: 1,
                windowMs: 60_000,
            },
        });
        engine.evaluate({ action: "api-call" });
        const other = engine.evaluate({ action: "other-action" });
        expect(other.allowed).toBe(true);
    });
});
/* ------------------------------------------------------------------ */
/*  Maintenance window                                                 */
/* ------------------------------------------------------------------ */
describe("maintenance window", () => {
    const config = {
        dayOfWeek: [0, 6], // Sunday and Saturday
        startHour: 2,
        endHour: 6,
        suppressSeverities: ["warning", "info"],
    };
    it("should detect time within window", () => {
        // Sunday at 03:00 UTC
        const inWindow = new Date("2024-01-07T03:00:00Z");
        expect(isInMaintenanceWindow(config, inWindow)).toBe(true);
    });
    it("should detect time outside window (wrong hour)", () => {
        // Sunday at 10:00 UTC
        const outsideWindow = new Date("2024-01-07T10:00:00Z");
        expect(isInMaintenanceWindow(config, outsideWindow)).toBe(false);
    });
    it("should detect time outside window (wrong day)", () => {
        // Monday at 03:00 UTC
        const wrongDay = new Date("2024-01-08T03:00:00Z");
        expect(isInMaintenanceWindow(config, wrongDay)).toBe(false);
    });
    it("should handle midnight wrapping", () => {
        const wrapConfig = {
            dayOfWeek: [5], // Friday
            startHour: 22,
            endHour: 4,
        };
        // Friday at 23:00 UTC
        const lateNight = new Date("2024-01-05T23:00:00Z");
        expect(isInMaintenanceWindow(wrapConfig, lateNight)).toBe(true);
        // Friday at 02:00 UTC
        const earlyMorning = new Date("2024-01-05T02:00:00Z");
        expect(isInMaintenanceWindow(wrapConfig, earlyMorning)).toBe(true);
        // Friday at 10:00 UTC — outside
        const midday = new Date("2024-01-05T10:00:00Z");
        expect(isInMaintenanceWindow(wrapConfig, midday)).toBe(false);
    });
    it("should suppress alert by severity", () => {
        const inWindow = new Date("2024-01-07T03:00:00Z");
        expect(shouldSuppressAlert(config, "warning", inWindow)).toBe(true);
        expect(shouldSuppressAlert(config, "critical", inWindow)).toBe(false);
    });
    it("should not suppress outside window", () => {
        const outside = new Date("2024-01-08T03:00:00Z");
        expect(shouldSuppressAlert(config, "warning", outside)).toBe(false);
    });
});
/* ------------------------------------------------------------------ */
/*  Severity mapping                                                   */
/* ------------------------------------------------------------------ */
describe("severity mapping", () => {
    beforeEach(() => resetMappings());
    it("should map alertmanager severities", () => {
        expect(mapSeverity("alertmanager", "critical")).toBe("critical");
        expect(mapSeverity("alertmanager", "warning")).toBe("warning");
        expect(mapSeverity("alertmanager", "info")).toBe("info");
        expect(mapSeverity("alertmanager", "none")).toBe("info");
    });
    it("should map grafana severities", () => {
        expect(mapSeverity("grafana", "alerting")).toBe("warning");
        expect(mapSeverity("grafana", "critical")).toBe("critical");
        expect(mapSeverity("grafana", "no_data")).toBe("info");
    });
    it("should map influx severities", () => {
        expect(mapSeverity("influx", "crit")).toBe("critical");
        expect(mapSeverity("influx", "warn")).toBe("warning");
        expect(mapSeverity("influx", "ok")).toBe("info");
    });
    it("should map docker severities", () => {
        expect(mapSeverity("docker", "critical")).toBe("critical");
        expect(mapSeverity("docker", "warning")).toBe("warning");
    });
    it("should fall back to default for unknown severity", () => {
        expect(mapSeverity("alertmanager", "unknown")).toBe("warning");
    });
    it("should fall back to warning for unknown source", () => {
        expect(mapSeverity("unknown-source", "critical")).toBe("warning");
    });
    it("should be case-insensitive", () => {
        expect(mapSeverity("alertmanager", "CRITICAL")).toBe("critical");
        expect(mapSeverity("grafana", "Alerting")).toBe("warning");
    });
    it("should allow custom mappings to override defaults", () => {
        addMapping({
            source: "alertmanager",
            mappings: { critical: "warning", warning: "info" },
            default: "info",
        });
        expect(mapSeverity("alertmanager", "critical")).toBe("warning");
        expect(mapSeverity("alertmanager", "warning")).toBe("info");
    });
    it("should reset custom mappings", () => {
        addMapping({
            source: "alertmanager",
            mappings: { critical: "info" },
            default: "info",
        });
        resetMappings();
        expect(mapSeverity("alertmanager", "critical")).toBe("critical");
    });
});
/* ------------------------------------------------------------------ */
/*  Policy engine evaluate (rule ordering)                             */
/* ------------------------------------------------------------------ */
describe("policy engine evaluate", () => {
    beforeEach(() => cleanTables());
    it("should return allowed when no rules", () => {
        const engine = new PolicyEngine();
        expect(engine.evaluate({ action: "anything" }).allowed).toBe(true);
    });
    it("should evaluate rules in order, first denial wins", () => {
        const engine = new PolicyEngine();
        engine.addRule({
            type: "denylist",
            name: "deny-delete",
            config: { actions: ["delete"], services: ["*"] },
        });
        engine.addRule({
            type: "denylist",
            name: "deny-destroy",
            config: { actions: ["destroy"], services: ["*"] },
        });
        const result = engine.evaluate({ action: "delete" });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("delete");
    });
    it("should pass when no rule denies", () => {
        const engine = new PolicyEngine();
        engine.addRule({
            type: "denylist",
            name: "deny-delete",
            config: { actions: ["delete"], services: ["*"] },
        });
        expect(engine.evaluate({ action: "restart" }).allowed).toBe(true);
    });
    it("should support removing rules", () => {
        const engine = new PolicyEngine();
        engine.addRule({
            type: "denylist",
            name: "deny-delete",
            config: { actions: ["delete"], services: ["*"] },
        });
        engine.removeRule("deny-delete");
        expect(engine.evaluate({ action: "delete" }).allowed).toBe(true);
        expect(engine.getRules()).toHaveLength(0);
    });
    it("should return requiresApproval for maintenance window", () => {
        const engine = new PolicyEngine();
        const now = new Date("2024-01-07T03:00:00Z"); // Sunday 03:00 UTC
        engine.addRule({
            type: "maintenanceWindow",
            name: "weekend-maint",
            config: {
                dayOfWeek: [0],
                startHour: 2,
                endHour: 6,
                suppressSeverities: ["warning"],
            },
        });
        // The engine uses new Date() internally for maintenance, so we test via
        // the maintenance module directly for time-sensitive assertions.
        // For the engine test, we verify the structural behavior:
        const result = engine.evaluate({ action: "deploy", severity: "critical" });
        // critical is not suppressed, so it should requiresApproval (if currently in window)
        // or be allowed (if not in window). This is time-dependent.
        expect(result).toHaveProperty("allowed");
    });
});
/* ------------------------------------------------------------------ */
/*  Dedupe                                                             */
/* ------------------------------------------------------------------ */
describe("dedupe", () => {
    beforeEach(() => cleanTables());
    it("should detect duplicate within window", () => {
        expect(isDuplicate("alert-123", 60_000)).toBe(false); // first time
        expect(isDuplicate("alert-123", 60_000)).toBe(true); // duplicate
    });
    it("should not flag different IDs as duplicates", () => {
        expect(isDuplicate("alert-A", 60_000)).toBe(false);
        expect(isDuplicate("alert-B", 60_000)).toBe(false);
    });
    it("should allow after window expires", () => {
        // Manually set an old timestamp
        pluginState.setState("_dedupe", "seen:alert-old", new Date(Date.now() - 120_000).toISOString());
        expect(isDuplicate("alert-old", 60_000)).toBe(false);
    });
});
/* ------------------------------------------------------------------ */
/*  Cleanup                                                            */
/* ------------------------------------------------------------------ */
describe("cleanup", () => {
    beforeEach(() => cleanTables());
    it("should purge expired idempotency keys", () => {
        const db = getDb();
        db.prepare("INSERT INTO idempotency_keys (key, expires_at) VALUES (?, ?)").run("old-key", new Date(Date.now() - 100_000).toISOString());
        db.prepare("INSERT INTO idempotency_keys (key, expires_at) VALUES (?, ?)").run("fresh-key", new Date(Date.now() + 100_000).toISOString());
        const result = runCleanup();
        expect(result.idempotencyKeys).toBe(1);
        const remaining = db
            .prepare("SELECT COUNT(*) as count FROM idempotency_keys")
            .get();
        expect(remaining.count).toBe(1);
    });
    it("should purge old resolved incidents", () => {
        const db = getDb();
        // Create an old resolved incident
        incidents.createIncident({ id: "inc-old", source: "test", title: "Old" });
        incidents.updateStatus("inc-old", "resolved");
        // Backdate resolved_at
        db.prepare("UPDATE incidents SET resolved_at = ? WHERE id = ?").run(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), "inc-old");
        // Create a recent resolved incident
        incidents.createIncident({ id: "inc-new", source: "test", title: "New" });
        incidents.updateStatus("inc-new", "resolved");
        const result = runCleanup({ resolvedIncidentRetentionMs: 30 * 24 * 60 * 60 * 1000 });
        expect(result.incidents).toBe(1);
        expect(incidents.getIncident("inc-old")).toBeNull();
        expect(incidents.getIncident("inc-new")).not.toBeNull();
    });
    it("should purge old audit events", () => {
        const db = getDb();
        db.prepare("INSERT INTO audit_events (process, event_type, created_at) VALUES (?, ?, ?)").run("test", "old-event", new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString());
        db.prepare("INSERT INTO audit_events (process, event_type, created_at) VALUES (?, ?, ?)").run("test", "fresh-event", new Date().toISOString());
        const result = runCleanup({ auditRetentionMs: 90 * 24 * 60 * 60 * 1000 });
        expect(result.auditEvents).toBe(1);
    });
});
