import { getDb } from "./db.js";

export interface ScheduleRun {
  id: number;
  plugin_name: string;
  schedule_name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
}

export function insertRun(pluginName: string, scheduleName: string): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO schedule_runs (plugin_name, schedule_name) VALUES (?, ?)
  `).run(pluginName, scheduleName);
  return Number(result.lastInsertRowid);
}

export function startRun(id: number): void {
  const db = getDb();
  db.prepare("UPDATE schedule_runs SET status = 'running', started_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function completeRun(id: number, result?: string): void {
  const db = getDb();
  db.prepare("UPDATE schedule_runs SET status = 'completed', completed_at = ?, result = ? WHERE id = ?").run(new Date().toISOString(), result ?? null, id);
}

export function failRun(id: number, error: string): void {
  const db = getDb();
  db.prepare("UPDATE schedule_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?").run(new Date().toISOString(), error, id);
}

export function getLastRun(pluginName: string, scheduleName: string): ScheduleRun | null {
  const db = getDb();
  return (db.prepare(`
    SELECT * FROM schedule_runs WHERE plugin_name = ? AND schedule_name = ? ORDER BY created_at DESC LIMIT 1
  `).get(pluginName, scheduleName) as ScheduleRun | undefined) ?? null;
}

export function isRunning(pluginName: string, scheduleName: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM schedule_runs WHERE plugin_name = ? AND schedule_name = ? AND status = 'running'
  `).get(pluginName, scheduleName) as { count: number };
  return row.count > 0;
}
