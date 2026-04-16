import { getDb } from "./db.js";

export interface Incident {
  id: string;
  source: string;
  source_id: string | null;
  service_name: string | null;
  title: string;
  severity: string;
  status: string;
  thread_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  metadata: Record<string, unknown> | null;
}

interface IncidentRow {
  id: string;
  source: string;
  source_id: string | null;
  service_name: string | null;
  title: string;
  severity: string;
  status: string;
  thread_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  metadata: string | null;
}

function rowToIncident(row: IncidentRow): Incident {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

export function createIncident(incident: {
  id: string;
  source: string;
  source_id?: string;
  service_name?: string;
  title: string;
  severity?: string;
  metadata?: Record<string, unknown>;
}): Incident {
  const db = getDb();
  db.prepare(`
    INSERT INTO incidents (id, source, source_id, service_name, title, severity, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    incident.id,
    incident.source,
    incident.source_id ?? null,
    incident.service_name ?? null,
    incident.title,
    incident.severity ?? "warning",
    incident.metadata ? JSON.stringify(incident.metadata) : null
  );
  return getIncident(incident.id)!;
}

export function getIncident(id: string): Incident | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM incidents WHERE id = ?").get(id) as IncidentRow | undefined;
  return row ? rowToIncident(row) : null;
}

export function findBySourceId(source: string, sourceId: string): Incident | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM incidents WHERE source = ? AND source_id = ?").get(source, sourceId) as IncidentRow | undefined;
  return row ? rowToIncident(row) : null;
}

export function listIncidents(status?: string): Incident[] {
  const db = getDb();
  if (status) {
    return (db.prepare("SELECT * FROM incidents WHERE status = ? ORDER BY created_at DESC").all(status) as IncidentRow[]).map(rowToIncident);
  }
  return (db.prepare("SELECT * FROM incidents ORDER BY created_at DESC").all() as IncidentRow[]).map(rowToIncident);
}

export function updateStatus(id: string, status: string): void {
  const db = getDb();
  const updates: Record<string, string | null> = { status, updated_at: new Date().toISOString() };
  if (status === "resolved" || status === "closed") {
    updates.resolved_at = new Date().toISOString();
  }
  db.prepare(`
    UPDATE incidents SET status = ?, updated_at = ?, resolved_at = COALESCE(?, resolved_at)
    WHERE id = ?
  `).run(updates.status, updates.updated_at, updates.resolved_at ?? null, id);
}

export function setThreadId(id: string, threadId: string): void {
  const db = getDb();
  db.prepare("UPDATE incidents SET thread_id = ?, updated_at = ? WHERE id = ?").run(threadId, new Date().toISOString(), id);
}
