import { getDb } from "./db.js";
function rowToCommand(row) {
    return { ...row, payload: row.payload ? JSON.parse(row.payload) : null };
}
export function insertCommand(cmd) {
    const db = getDb();
    const result = db.prepare(`
    INSERT INTO operator_commands (incident_id, command_type, actor, payload)
    VALUES (?, ?, ?, ?)
  `).run(cmd.incident_id ?? null, cmd.command_type, cmd.actor, cmd.payload ? JSON.stringify(cmd.payload) : null);
    return Number(result.lastInsertRowid);
}
export function claimPending(limit = 10) {
    const db = getDb();
    const now = new Date().toISOString();
    return db.transaction(() => {
        const rows = db.prepare(`
      SELECT * FROM operator_commands WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?
    `).all(limit);
        if (rows.length === 0)
            return [];
        const ids = rows.map((r) => r.id);
        const result = db.prepare(`
      UPDATE operator_commands SET status = 'claimed', claimed_at = ?
      WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'pending'
    `).run(now, ...ids);
        if (result.changes === 0)
            return [];
        // Re-read the actually claimed rows
        const claimed = db.prepare(`
      SELECT * FROM operator_commands
      WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'claimed' AND claimed_at = ?
    `).all(...ids, now);
        return claimed.map((r) => rowToCommand(r));
    })();
}
export function markExecuted(id, result) {
    const db = getDb();
    db.prepare("UPDATE operator_commands SET status = 'executed', result = ? WHERE id = ?").run(result ?? null, id);
}
export function markFailed(id, result) {
    const db = getDb();
    db.prepare("UPDATE operator_commands SET status = 'failed', result = ? WHERE id = ?").run(result, id);
}
