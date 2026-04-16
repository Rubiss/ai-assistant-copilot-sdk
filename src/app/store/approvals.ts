import { getDb } from "./db.js";

export interface ApprovalDecision {
  id: number;
  incident_id: string | null;
  action_name: string;
  requested_by: string;
  decided_by: string | null;
  decision: string | null;
  reason: string | null;
  requested_at: string;
  decided_at: string | null;
}

export function requestApproval(req: {
  incident_id?: string;
  action_name: string;
  requested_by: string;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO approval_decisions (incident_id, action_name, requested_by)
    VALUES (?, ?, ?)
  `).run(req.incident_id ?? null, req.action_name, req.requested_by);
  return Number(result.lastInsertRowid);
}

export function decide(id: number, decision: { decided_by: string; decision: "approved" | "denied"; reason?: string }): void {
  const db = getDb();
  db.prepare(`
    UPDATE approval_decisions SET decided_by = ?, decision = ?, reason = ?, decided_at = ? WHERE id = ?
  `).run(decision.decided_by, decision.decision, decision.reason ?? null, new Date().toISOString(), id);
}

export function getPending(incidentId?: string): ApprovalDecision[] {
  const db = getDb();
  if (incidentId) {
    return db.prepare("SELECT * FROM approval_decisions WHERE decision IS NULL AND incident_id = ? ORDER BY requested_at").all(incidentId) as ApprovalDecision[];
  }
  return db.prepare("SELECT * FROM approval_decisions WHERE decision IS NULL ORDER BY requested_at").all() as ApprovalDecision[];
}

export function getDecision(id: number): ApprovalDecision | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM approval_decisions WHERE id = ?").get(id) as ApprovalDecision | undefined) ?? null;
}
