import { getDb } from "./db.js";
export function requestApproval(req) {
    const db = getDb();
    const result = db.prepare(`
    INSERT INTO approval_decisions (incident_id, action_name, requested_by)
    VALUES (?, ?, ?)
  `).run(req.incident_id ?? null, req.action_name, req.requested_by);
    return Number(result.lastInsertRowid);
}
export function decide(id, decision) {
    const db = getDb();
    db.prepare(`
    UPDATE approval_decisions SET decided_by = ?, decision = ?, reason = ?, decided_at = ? WHERE id = ?
  `).run(decision.decided_by, decision.decision, decision.reason ?? null, new Date().toISOString(), id);
}
export function getPending(incidentId) {
    const db = getDb();
    if (incidentId) {
        return db.prepare("SELECT * FROM approval_decisions WHERE decision IS NULL AND incident_id = ? ORDER BY requested_at").all(incidentId);
    }
    return db.prepare("SELECT * FROM approval_decisions WHERE decision IS NULL ORDER BY requested_at").all();
}
export function getDecision(id) {
    const db = getDb();
    return db.prepare("SELECT * FROM approval_decisions WHERE id = ?").get(id) ?? null;
}
