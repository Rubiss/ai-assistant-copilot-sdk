import { getDb } from "../store/db.js";
import { logAudit } from "../store/audit.js";
const DEFAULT_CONFIG = {
    idempotencyKeyTtlMs: 24 * 60 * 60 * 1000,
    resolvedIncidentRetentionMs: 30 * 24 * 60 * 60 * 1000,
    auditRetentionMs: 90 * 24 * 60 * 60 * 1000,
};
export function runCleanup(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const db = getDb();
    // Purge expired idempotency keys
    const idempotencyKeys = db
        .prepare("DELETE FROM idempotency_keys WHERE expires_at IS NOT NULL AND expires_at < ?")
        .run(new Date().toISOString()).changes;
    // Archive old resolved/closed incidents (delete events first due to FK)
    const cutoff = new Date(Date.now() - cfg.resolvedIncidentRetentionMs).toISOString();
    const oldIncidentIds = db
        .prepare("SELECT id FROM incidents WHERE status IN ('resolved', 'closed') AND resolved_at < ?")
        .all(cutoff);
    let incidents = 0;
    if (oldIncidentIds.length > 0) {
        const ids = oldIncidentIds.map((r) => r.id);
        const placeholders = ids.map(() => "?").join(",");
        db.prepare(`DELETE FROM incident_events WHERE incident_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM operator_commands WHERE incident_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM approval_decisions WHERE incident_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM notifications_outbox WHERE thread_id IN (SELECT thread_id FROM incidents WHERE id IN (${placeholders}))`).run(...ids);
        incidents = db
            .prepare(`DELETE FROM incidents WHERE id IN (${placeholders})`)
            .run(...ids).changes;
    }
    // Purge old audit events
    const auditCutoff = new Date(Date.now() - cfg.auditRetentionMs).toISOString();
    const auditEvents = db
        .prepare("DELETE FROM audit_events WHERE created_at < ?")
        .run(auditCutoff).changes;
    // Purge old plugin state entries for policy engine
    const policyStateCutoff = new Date(Date.now() - cfg.idempotencyKeyTtlMs).toISOString();
    db.prepare("DELETE FROM plugin_state WHERE plugin_name IN ('_policy_engine', '_dedupe') AND updated_at < ?").run(policyStateCutoff);
    try {
        logAudit({
            process: "worker",
            event_type: "cleanup",
            detail: { idempotencyKeys, incidents, auditEvents },
        });
    }
    catch { }
    return { idempotencyKeys, incidents, auditEvents };
}
