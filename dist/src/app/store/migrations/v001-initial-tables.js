import { getDb } from "../db.js";
import { defineMigration } from "../migrations.js";
defineMigration(1, "initial-tables", () => {
    const db = getDb();
    db.exec(`
    -- Incidents
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT,
      service_name TEXT,
      title TEXT NOT NULL,
      severity TEXT DEFAULT 'warning',
      status TEXT DEFAULT 'open',
      thread_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      metadata TEXT
    );

    -- Incident events (timeline)
    CREATE TABLE IF NOT EXISTS incident_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      event_type TEXT NOT NULL,
      actor TEXT,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Notifications outbox
    CREATE TABLE IF NOT EXISTS notifications_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      thread_id TEXT,
      message_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      claimed_at TEXT,
      delivered_at TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Operator commands (bot → worker)
    CREATE TABLE IF NOT EXISTS operator_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT REFERENCES incidents(id),
      command_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      payload TEXT,
      status TEXT DEFAULT 'pending',
      claimed_at TEXT,
      result TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Approval decisions
    CREATE TABLE IF NOT EXISTS approval_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT REFERENCES incidents(id),
      action_name TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      decided_by TEXT,
      decision TEXT,
      reason TEXT,
      requested_at TEXT DEFAULT (datetime('now')),
      decided_at TEXT
    );

    -- Plugin state (key-value per plugin)
    CREATE TABLE IF NOT EXISTS plugin_state (
      plugin_name TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (plugin_name, key)
    );

    -- Schedule runs
    CREATE TABLE IF NOT EXISTS schedule_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_name TEXT NOT NULL,
      schedule_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      result TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Audit events
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT,
      target TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Idempotency keys
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      result TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_source_id ON incidents(source_id);
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON notifications_outbox(status);
    CREATE INDEX IF NOT EXISTS idx_operator_commands_status ON operator_commands(status);
    CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_schedule_runs_plugin ON schedule_runs(plugin_name, schedule_name);
  `);
});
