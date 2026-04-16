import { getDb } from "./db.js";
export function logAudit(event) {
    const db = getDb();
    const result = db.prepare(`
    INSERT INTO audit_events (process, event_type, actor, target, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(event.process, event.event_type, event.actor ?? null, event.target ?? null, event.detail ? JSON.stringify(event.detail) : null);
    return Number(result.lastInsertRowid);
}
export function queryAudit(opts) {
    const db = getDb();
    const conditions = [];
    const params = [];
    if (opts.eventType) {
        conditions.push("event_type = ?");
        params.push(opts.eventType);
    }
    if (opts.actor) {
        conditions.push("actor = ?");
        params.push(opts.actor);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, opts.limit ?? 100);
    return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}
