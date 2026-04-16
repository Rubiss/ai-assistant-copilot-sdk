import { getDb } from "./db.js";
export function getState(pluginName, key) {
    const db = getDb();
    const row = db.prepare("SELECT value FROM plugin_state WHERE plugin_name = ? AND key = ?").get(pluginName, key);
    return row?.value ?? null;
}
export function setState(pluginName, key, value) {
    const db = getDb();
    db.prepare(`
    INSERT INTO plugin_state (plugin_name, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(plugin_name, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(pluginName, key, value, new Date().toISOString());
}
export function deleteState(pluginName, key) {
    const db = getDb();
    db.prepare("DELETE FROM plugin_state WHERE plugin_name = ? AND key = ?").run(pluginName, key);
}
export function getAllState(pluginName) {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM plugin_state WHERE plugin_name = ?").all(pluginName);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
