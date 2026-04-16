import { getDb } from "./db.js";

export interface OperatorCommand {
  id: number;
  incident_id: string | null;
  command_type: string;
  actor: string;
  payload: Record<string, unknown> | null;
  status: string;
  claimed_at: string | null;
  result: string | null;
  created_at: string;
}

interface CommandRow {
  id: number;
  incident_id: string | null;
  command_type: string;
  actor: string;
  payload: string | null;
  status: string;
  claimed_at: string | null;
  result: string | null;
  created_at: string;
}

function rowToCommand(row: CommandRow): OperatorCommand {
  return { ...row, payload: row.payload ? JSON.parse(row.payload) : null };
}

export function insertCommand(cmd: {
  incident_id?: string;
  command_type: string;
  actor: string;
  payload?: Record<string, unknown>;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO operator_commands (incident_id, command_type, actor, payload)
    VALUES (?, ?, ?, ?)
  `).run(cmd.incident_id ?? null, cmd.command_type, cmd.actor, cmd.payload ? JSON.stringify(cmd.payload) : null);
  return Number(result.lastInsertRowid);
}

export function claimPending(limit: number = 10): OperatorCommand[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db.transaction(() => {
    const rows = db.prepare(`
      SELECT * FROM operator_commands WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?
    `).all(limit) as CommandRow[];
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    db.prepare(`
      UPDATE operator_commands SET status = 'claimed', claimed_at = ?
      WHERE id IN (${ids.map(() => "?").join(",")})
    `).run(now, ...ids);
    return rows.map((r) => rowToCommand({ ...r, status: "claimed", claimed_at: now }));
  })();
}

export function markExecuted(id: number, result?: string): void {
  const db = getDb();
  db.prepare("UPDATE operator_commands SET status = 'executed', result = ? WHERE id = ?").run(result ?? null, id);
}

export function markFailed(id: number, result: string): void {
  const db = getDb();
  db.prepare("UPDATE operator_commands SET status = 'failed', result = ? WHERE id = ?").run(result, id);
}
