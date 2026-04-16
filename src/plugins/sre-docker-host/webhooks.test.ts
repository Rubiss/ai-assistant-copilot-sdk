import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// Mock the DB so incidentEngine (and all store modules) use in-memory SQLite
vi.mock("../../app/store/db.js", async () => {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return {
    getDb: () => db,
    closeDb: () => {},
  };
});

import { getDb } from "../../app/store/db.js";
import { runMigrations } from "../../app/store/migrations.js";
import "../../app/store/migrations/v001-initial-tables.js";
import * as incidents from "../../app/store/incidents.js";
import * as outbox from "../../app/store/outbox.js";
import { processAlert } from "../../worker/incidentEngine.js";
import {
  normalizeAlertmanager,
  normalizeGrafana,
  normalizeInflux,
  mapAlertmanagerSeverity,
  mapGrafanaSeverity,
  mapInfluxSeverity,
} from "./webhooks.js";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const alertmanagerFiring = {
  version: "4",
  groupKey: '{}:{alertname="HighMemory"}',
  status: "firing" as const,
  alerts: [
    {
      status: "firing" as const,
      labels: {
        alertname: "HighMemory",
        service: "nginx",
        severity: "critical",
        instance: "nginx:80",
      },
      annotations: {
        summary: "High memory usage on nginx",
        description: "Memory usage is above 90%",
      },
      startsAt: "2024-01-15T10:00:00Z",
      endsAt: "0001-01-01T00:00:00Z",
      fingerprint: "abc123",
    },
  ],
};

const alertmanagerResolved = {
  version: "4",
  groupKey: '{}:{alertname="HighMemory"}',
  status: "resolved" as const,
  alerts: [
    {
      status: "resolved" as const,
      labels: {
        alertname: "HighMemory",
        service: "nginx",
        severity: "critical",
      },
      annotations: { summary: "High memory usage on nginx" },
      startsAt: "2024-01-15T10:00:00Z",
      endsAt: "2024-01-15T10:30:00Z",
      fingerprint: "abc123",
    },
  ],
};

const grafanaAlerting = {
  status: "alerting" as const,
  alerts: [
    {
      status: "firing" as const,
      labels: { alertname: "HighCPU", grafana_folder: "Infrastructure" },
      annotations: {
        summary: "CPU usage above 80%",
        description: "Server CPU is high",
      },
      fingerprint: "def456",
      startsAt: "2024-01-15T10:00:00Z",
      endsAt: "0001-01-01T00:00:00Z",
      values: { B: 85.5 },
    },
  ],
};

const influxNotification = {
  _check_id: "check-001",
  _check_name: "Disk Usage",
  _level: "crit" as const,
  _message: "Disk usage on /data is above 95%",
  _source_measurement: "disk",
  _type: "threshold",
};

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  runMigrations();
});

afterAll(() => {
  getDb().close();
});

function cleanTables() {
  const db = getDb();
  for (const table of [
    "incident_events",
    "approval_decisions",
    "operator_commands",
    "notifications_outbox",
    "incidents",
    "plugin_state",
    "schedule_runs",
    "audit_events",
    "idempotency_keys",
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
}

/* ------------------------------------------------------------------ */
/*  Alertmanager normalizer                                            */
/* ------------------------------------------------------------------ */

describe("normalizeAlertmanager", () => {
  it("should parse firing payload into correct NormalizedAlert", () => {
    const alerts = normalizeAlertmanager(alertmanagerFiring);
    expect(alerts).toHaveLength(1);

    const alert = alerts[0];
    expect(alert.source).toBe("alertmanager");
    expect(alert.source_id).toBe("alertmanager:abc123");
    expect(alert.service_name).toBe("nginx");
    expect(alert.title).toBe("High memory usage on nginx");
    expect(alert.severity).toBe("critical");
    expect(alert.status).toBe("firing");
    expect(alert.metadata).toMatchObject({
      labels: alertmanagerFiring.alerts[0].labels,
      annotations: alertmanagerFiring.alerts[0].annotations,
      startsAt: "2024-01-15T10:00:00Z",
    });
  });

  it("should parse resolved payload with status = resolved", () => {
    const alerts = normalizeAlertmanager(alertmanagerResolved);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].status).toBe("resolved");
    expect(alerts[0].source_id).toBe("alertmanager:abc123");
  });

  it("should handle missing optional fields gracefully", () => {
    const minimal = {
      version: "4",
      groupKey: "{}:{}",
      status: "firing" as const,
      alerts: [
        {
          status: "firing" as const,
          labels: { alertname: "TestAlert" },
          annotations: {},
          startsAt: "2024-01-15T10:00:00Z",
          endsAt: "0001-01-01T00:00:00Z",
          fingerprint: "min123",
        },
      ],
    };

    const alerts = normalizeAlertmanager(minimal);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].source_id).toBe("alertmanager:min123");
    // No service/job/instance → undefined
    expect(alerts[0].service_name).toBeUndefined();
    // No summary → falls back to alertname
    expect(alerts[0].title).toBe("TestAlert");
    // No severity label → defaults to info
    expect(alerts[0].severity).toBe("info");
  });

  it("should fall back to 'Alertmanager Alert' when no summary or alertname", () => {
    const bare = {
      version: "4",
      groupKey: "{}:{}",
      status: "firing" as const,
      alerts: [
        {
          status: "firing" as const,
          labels: {},
          annotations: {},
          startsAt: "2024-01-15T10:00:00Z",
          endsAt: "0001-01-01T00:00:00Z",
          fingerprint: "bare123",
        },
      ],
    };
    const alerts = normalizeAlertmanager(bare);
    expect(alerts[0].title).toBe("Alertmanager Alert");
  });
});

describe("mapAlertmanagerSeverity", () => {
  it("should map critical → critical", () => {
    expect(mapAlertmanagerSeverity("critical")).toBe("critical");
  });
  it("should map error → critical", () => {
    expect(mapAlertmanagerSeverity("error")).toBe("critical");
  });
  it("should map warning → warning", () => {
    expect(mapAlertmanagerSeverity("warning")).toBe("warning");
  });
  it("should map unknown/undefined → info", () => {
    expect(mapAlertmanagerSeverity(undefined)).toBe("info");
    expect(mapAlertmanagerSeverity("other")).toBe("info");
  });
});

/* ------------------------------------------------------------------ */
/*  Grafana normalizer                                                 */
/* ------------------------------------------------------------------ */

describe("normalizeGrafana", () => {
  it("should parse alerting payload into correct NormalizedAlert", () => {
    const alerts = normalizeGrafana(grafanaAlerting);
    expect(alerts).toHaveLength(1);

    const alert = alerts[0];
    expect(alert.source).toBe("grafana");
    expect(alert.source_id).toBe("grafana:def456");
    // No `service` label, falls back to grafana_folder
    expect(alert.service_name).toBe("Infrastructure");
    expect(alert.title).toBe("CPU usage above 80%");
    expect(alert.status).toBe("firing");
    expect(alert.metadata).toMatchObject({
      values: { B: 85.5 },
    });
  });

  it("should prefer service label over grafana_folder", () => {
    const withService = {
      ...grafanaAlerting,
      alerts: [
        {
          ...grafanaAlerting.alerts[0],
          labels: {
            ...grafanaAlerting.alerts[0].labels,
            service: "api-gateway",
          },
        },
      ],
    };
    const alerts = normalizeGrafana(withService);
    expect(alerts[0].service_name).toBe("api-gateway");
  });
});

describe("mapGrafanaSeverity", () => {
  it("should map critical → critical", () => {
    expect(mapGrafanaSeverity("critical")).toBe("critical");
  });
  it("should map error → critical", () => {
    expect(mapGrafanaSeverity("error")).toBe("critical");
  });
  it("should map warning → warning", () => {
    expect(mapGrafanaSeverity("warning")).toBe("warning");
  });
  it("should map unknown/undefined → info", () => {
    expect(mapGrafanaSeverity(undefined)).toBe("info");
    expect(mapGrafanaSeverity("something")).toBe("info");
  });
});

/* ------------------------------------------------------------------ */
/*  InfluxDB normalizer                                                */
/* ------------------------------------------------------------------ */

describe("normalizeInflux", () => {
  it("should parse notification into correct NormalizedAlert", () => {
    const alerts = normalizeInflux(influxNotification);
    expect(alerts).toHaveLength(1);

    const alert = alerts[0];
    expect(alert.source).toBe("influxdb");
    expect(alert.source_id).toBe("influxdb:check-001");
    expect(alert.service_name).toBe("disk");
    expect(alert.title).toBe("Disk usage on /data is above 95%");
    expect(alert.severity).toBe("critical");
    expect(alert.status).toBe("firing");
    expect(alert.metadata).toMatchObject({
      checkId: "check-001",
      checkName: "Disk Usage",
      level: "crit",
      type: "threshold",
      sourceMeasurement: "disk",
    });
  });

  it("should map ok level → resolved status", () => {
    const okPayload = { ...influxNotification, _level: "ok" as const };
    const alerts = normalizeInflux(okPayload);
    expect(alerts[0].status).toBe("resolved");
    expect(alerts[0].severity).toBe("info");
  });

  it("should fall back to _check_name when _message is empty", () => {
    const noMsg = { ...influxNotification, _message: "" };
    const alerts = normalizeInflux(noMsg);
    expect(alerts[0].title).toBe("Disk Usage");
  });
});

describe("mapInfluxSeverity", () => {
  it("should map crit → critical", () => {
    expect(mapInfluxSeverity("crit")).toBe("critical");
  });
  it("should map warn → warning", () => {
    expect(mapInfluxSeverity("warn")).toBe("warning");
  });
  it("should map info → info", () => {
    expect(mapInfluxSeverity("info")).toBe("info");
  });
  it("should map ok → info", () => {
    expect(mapInfluxSeverity("ok")).toBe("info");
  });
});

/* ------------------------------------------------------------------ */
/*  Integration: webhook → incident → outbox                           */
/* ------------------------------------------------------------------ */

describe("webhook → incident engine integration", () => {
  beforeEach(() => cleanTables());

  it("should create incident and outbox message from alertmanager alert", () => {
    const alerts = normalizeAlertmanager(alertmanagerFiring);
    const result = processAlert(alerts[0], { alertChannelId: "ch-alerts" });

    expect(result.created).toBe(true);

    // Incident was persisted
    const incident = incidents.getIncident(result.incidentId);
    expect(incident).not.toBeNull();
    expect(incident!.source).toBe("alertmanager");
    expect(incident!.source_id).toBe("alertmanager:abc123");
    expect(incident!.service_name).toBe("nginx");
    expect(incident!.severity).toBe("critical");
    expect(incident!.status).toBe("open");

    // Outbox message was inserted
    const messages = outbox.claimPending(10);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const alertMsg = messages.find((m) => m.message_type === "alert");
    expect(alertMsg).toBeDefined();
    expect(alertMsg!.channel_id).toBe("ch-alerts");
  });

  it("should deduplicate a repeated firing alert", () => {
    const alerts = normalizeAlertmanager(alertmanagerFiring);
    const first = processAlert(alerts[0], { alertChannelId: "ch-alerts" });
    const second = processAlert(alerts[0], { alertChannelId: "ch-alerts" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.incidentId).toBe(first.incidentId);
  });

  it("should resolve an existing incident from a resolved alert", () => {
    // First, fire the alert to create the incident
    const firingAlerts = normalizeAlertmanager(alertmanagerFiring);
    const { incidentId } = processAlert(firingAlerts[0], {
      alertChannelId: "ch-alerts",
    });

    // Then send the resolved version
    const resolvedAlerts = normalizeAlertmanager(alertmanagerResolved);
    const result = processAlert(resolvedAlerts[0], {
      alertChannelId: "ch-alerts",
    });

    expect(result.created).toBe(false);
    expect(result.incidentId).toBe(incidentId);

    const incident = incidents.getIncident(incidentId);
    expect(incident!.status).toBe("resolved");
    expect(incident!.resolved_at).not.toBeNull();
  });

  it("should create incident from Grafana alert and insert outbox message", () => {
    const alerts = normalizeGrafana(grafanaAlerting);
    const result = processAlert(alerts[0], { alertChannelId: "ch-grafana" });

    expect(result.created).toBe(true);

    const incident = incidents.getIncident(result.incidentId);
    expect(incident!.source).toBe("grafana");
    expect(incident!.service_name).toBe("Infrastructure");

    const messages = outbox.claimPending(10);
    expect(messages.some((m) => m.channel_id === "ch-grafana")).toBe(true);
  });

  it("should create incident from InfluxDB alert and insert outbox message", () => {
    const alerts = normalizeInflux(influxNotification);
    const result = processAlert(alerts[0], { alertChannelId: "ch-influx" });

    expect(result.created).toBe(true);

    const incident = incidents.getIncident(result.incidentId);
    expect(incident!.source).toBe("influxdb");
    expect(incident!.service_name).toBe("disk");
    expect(incident!.severity).toBe("critical");

    const messages = outbox.claimPending(10);
    expect(messages.some((m) => m.channel_id === "ch-influx")).toBe(true);
  });
});
