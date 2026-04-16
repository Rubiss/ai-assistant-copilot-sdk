import { getDb } from "./db.js";
function rowToMessage(row) {
    return { ...row, payload: JSON.parse(row.payload) };
}
export function insertOutboxMessage(msg) {
    const db = getDb();
    const result = db.prepare(`
    INSERT INTO notifications_outbox (channel_id, thread_id, message_type, payload, max_attempts)
    VALUES (?, ?, ?, ?, ?)
  `).run(msg.channel_id, msg.thread_id ?? null, msg.message_type, JSON.stringify(msg.payload), msg.max_attempts ?? 3);
    return Number(result.lastInsertRowid);
}
export function claimPending(limit = 10) {
    const db = getDb();
    const now = new Date().toISOString();
    return db.transaction(() => {
        const rows = db.prepare(`
      SELECT * FROM notifications_outbox
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit);
        if (rows.length === 0)
            return [];
        const ids = rows.map((r) => r.id);
        const result = db.prepare(`
      UPDATE notifications_outbox
      SET status = 'claimed', claimed_at = ?, attempts = attempts + 1
      WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'pending'
    `).run(now, ...ids);
        if (result.changes === 0)
            return [];
        // Re-read the actually claimed rows to avoid returning stale data
        const claimed = db.prepare(`
      SELECT * FROM notifications_outbox
      WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'claimed' AND claimed_at = ?
    `).all(...ids, now);
        return claimed.map((r) => rowToMessage(r));
    })();
}
export function markDelivered(id) {
    const db = getDb();
    db.prepare(`
    UPDATE notifications_outbox SET status = 'delivered', delivered_at = ? WHERE id = ?
  `).run(new Date().toISOString(), id);
}
export function markFailed(id, error) {
    const db = getDb();
    const row = db.prepare("SELECT attempts, max_attempts FROM notifications_outbox WHERE id = ?").get(id);
    if (!row)
        return;
    const newStatus = row.attempts >= row.max_attempts ? "failed" : "pending";
    db.prepare(`
    UPDATE notifications_outbox SET status = ?, error = ? WHERE id = ?
  `).run(newStatus, error, id);
}
export function setThreadId(id, threadId) {
    const db = getDb();
    db.prepare("UPDATE notifications_outbox SET thread_id = ? WHERE id = ?").run(threadId, id);
}
