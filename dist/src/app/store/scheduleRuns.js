import { getDb } from "./db.js";
export function insertRun(pluginName, scheduleName) {
    const db = getDb();
    const result = db.prepare(`
    INSERT INTO schedule_runs (plugin_name, schedule_name) VALUES (?, ?)
  `).run(pluginName, scheduleName);
    return Number(result.lastInsertRowid);
}
export function startRun(id) {
    const db = getDb();
    db.prepare("UPDATE schedule_runs SET status = 'running', started_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}
export function completeRun(id, result) {
    const db = getDb();
    db.prepare("UPDATE schedule_runs SET status = 'completed', completed_at = ?, result = ? WHERE id = ?").run(new Date().toISOString(), result ?? null, id);
}
export function failRun(id, error) {
    const db = getDb();
    db.prepare("UPDATE schedule_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?").run(new Date().toISOString(), error, id);
}
export function getLastRun(pluginName, scheduleName) {
    const db = getDb();
    return db.prepare(`
    SELECT * FROM schedule_runs WHERE plugin_name = ? AND schedule_name = ? ORDER BY created_at DESC LIMIT 1
  `).get(pluginName, scheduleName) ?? null;
}
export function isRunning(pluginName, scheduleName) {
    const db = getDb();
    const row = db.prepare(`
    SELECT COUNT(*) as count FROM schedule_runs WHERE plugin_name = ? AND schedule_name = ? AND status = 'running'
  `).get(pluginName, scheduleName);
    return row.count > 0;
}
