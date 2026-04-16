import { getDb } from "./db.js";
function rowToIncident(row) {
    return {
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
}
export function createIncident(incident) {
    const db = getDb();
    db.prepare(`
    INSERT INTO incidents (id, source, source_id, service_name, title, severity, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(incident.id, incident.source, incident.source_id ?? null, incident.service_name ?? null, incident.title, incident.severity ?? "warning", incident.metadata ? JSON.stringify(incident.metadata) : null);
    return getIncident(incident.id);
}
export function getIncident(id) {
    const db = getDb();
    const row = db.prepare("SELECT * FROM incidents WHERE id = ?").get(id);
    return row ? rowToIncident(row) : null;
}
export function findBySourceId(source, sourceId) {
    const db = getDb();
    const row = db.prepare("SELECT * FROM incidents WHERE source = ? AND source_id = ?").get(source, sourceId);
    return row ? rowToIncident(row) : null;
}
export function listIncidents(status) {
    const db = getDb();
    if (status) {
        return db.prepare("SELECT * FROM incidents WHERE status = ? ORDER BY created_at DESC").all(status).map(rowToIncident);
    }
    return db.prepare("SELECT * FROM incidents ORDER BY created_at DESC").all().map(rowToIncident);
}
export function updateStatus(id, status) {
    const db = getDb();
    const updates = { status, updated_at: new Date().toISOString() };
    if (status === "resolved" || status === "closed") {
        updates.resolved_at = new Date().toISOString();
    }
    db.prepare(`
    UPDATE incidents SET status = ?, updated_at = ?, resolved_at = COALESCE(?, resolved_at)
    WHERE id = ?
  `).run(updates.status, updates.updated_at, updates.resolved_at ?? null, id);
}
export function setThreadId(id, threadId) {
    const db = getDb();
    db.prepare("UPDATE incidents SET thread_id = ?, updated_at = ? WHERE id = ?").run(threadId, new Date().toISOString(), id);
}
