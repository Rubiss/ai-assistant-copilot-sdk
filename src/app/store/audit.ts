import { getDb } from "./db.js";

export interface AuditEvent {
  id: number;
  process: string;
  event_type: string;
  actor: string | null;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

interface AuditRow {
  id: number;
  process: string;
  event_type: string;
  actor: string | null;
  target: string | null;
  detail: string | null;
  created_at: string;
}

export function logAudit(event: {
  process: string;
  event_type: string;
  actor?: string;
  target?: string;
  detail?: Record<string, unknown>;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO audit_events (process, event_type, actor, target, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(event.process, event.event_type, event.actor ?? null, event.target ?? null, event.detail ? JSON.stringify(event.detail) : null);
  return Number(result.lastInsertRowid);
}

export function queryAudit(opts: { eventType?: string; actor?: string; limit?: number }): AuditEvent[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.eventType) { conditions.push("event_type = ?"); params.push(opts.eventType); }
  if (opts.actor) { conditions.push("actor = ?"); params.push(opts.actor); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, opts.limit ?? 100) as AuditRow[];

  return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}
