import type { NormalizedAlert } from "../../worker/incidentEngine.js";
import type { WebhookRoute } from "../../app/plugins/types.js";
import { processAlert } from "../../worker/incidentEngine.js";

/* ------------------------------------------------------------------ */
/*  Alertmanager                                                       */
/* ------------------------------------------------------------------ */

interface AlertmanagerPayload {
  version: string;
  groupKey: string;
  status: "firing" | "resolved";
  alerts: Array<{
    status: "firing" | "resolved";
    labels: Record<string, string>;
    annotations: Record<string, string>;
    startsAt: string;
    endsAt: string;
    fingerprint: string;
  }>;
}

export function mapAlertmanagerSeverity(
  severity: string | undefined,
): "critical" | "warning" | "info" {
  if (severity === "critical" || severity === "error") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}

export function normalizeAlertmanager(payload: AlertmanagerPayload): NormalizedAlert[] {
  return payload.alerts.map((alert) => ({
    source: "alertmanager",
    source_id: `alertmanager:${alert.fingerprint}`,
    service_name:
      alert.labels.service ?? alert.labels.job ?? alert.labels.instance,
    title:
      alert.annotations.summary ??
      alert.labels.alertname ??
      "Alertmanager Alert",
    severity: mapAlertmanagerSeverity(alert.labels.severity),
    status: alert.status,
    metadata: {
      labels: alert.labels,
      annotations: alert.annotations,
      startsAt: alert.startsAt,
      endsAt: alert.endsAt,
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  Grafana                                                            */
/* ------------------------------------------------------------------ */

interface GrafanaPayload {
  status: "alerting" | "ok" | "no_data" | "paused";
  alerts: Array<{
    status: "firing" | "resolved";
    labels: Record<string, string>;
    annotations: Record<string, string>;
    fingerprint: string;
    startsAt: string;
    endsAt: string;
    values: Record<string, number>;
  }>;
}

export function mapGrafanaSeverity(
  severity: string | undefined,
): "critical" | "warning" | "info" {
  if (severity === "critical" || severity === "error") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}

export function normalizeGrafana(payload: GrafanaPayload): NormalizedAlert[] {
  return payload.alerts.map((alert) => ({
    source: "grafana",
    source_id: `grafana:${alert.fingerprint}`,
    service_name: alert.labels.service ?? alert.labels.grafana_folder,
    title:
      alert.annotations.summary ??
      alert.labels.alertname ??
      "Grafana Alert",
    severity: mapGrafanaSeverity(alert.labels.severity),
    status: alert.status,
    metadata: {
      labels: alert.labels,
      annotations: alert.annotations,
      startsAt: alert.startsAt,
      endsAt: alert.endsAt,
      values: alert.values,
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  InfluxDB                                                           */
/* ------------------------------------------------------------------ */

interface InfluxPayload {
  _check_id: string;
  _check_name: string;
  _level: "crit" | "warn" | "info" | "ok";
  _message: string;
  _source_measurement: string;
  _type: string;
}

export function mapInfluxSeverity(
  level: string,
): "critical" | "warning" | "info" {
  if (level === "crit") return "critical";
  if (level === "warn") return "warning";
  return "info";
}

export function normalizeInflux(payload: InfluxPayload): NormalizedAlert[] {
  const status: "firing" | "resolved" =
    payload._level === "ok" ? "resolved" : "firing";

  return [
    {
      source: "influxdb",
      source_id: `influxdb:${payload._check_id}`,
      service_name: payload._source_measurement,
      title: payload._message || payload._check_name || "InfluxDB Alert",
      severity: mapInfluxSeverity(payload._level),
      status,
      metadata: {
        checkId: payload._check_id,
        checkName: payload._check_name,
        level: payload._level,
        type: payload._type,
        sourceMeasurement: payload._source_measurement,
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Servarr (Sonarr / Radarr / Prowlarr / Lidarr / Readarr)           */
/* ------------------------------------------------------------------ */

interface ServarrHealthMessage {
  type: string;
  message: string;
  source?: string;
  wikiUrl?: string;
  level?: number;
}

interface ServarrPayload {
  eventType: string;
  instanceName?: string;
  reason?: string;
  messages?: ServarrHealthMessage[];
  isHealthy?: boolean;
  appVersion?: string;
  appUrl?: string;
  // ApplicationUpdate fields
  previousVersion?: string;
  newVersion?: string;
}

const SERVARR_ALERT_EVENTS = new Set(["Health", "HealthRestored", "ApplicationUpdate"]);

export function mapServarrSeverity(
  level: number | undefined,
  type: string | undefined,
): "critical" | "warning" | "info" {
  if (type === "Error" || level === 2) return "critical";
  if (type === "Warning" || level === 1) return "warning";
  return "info";
}

export function normalizeServarr(payload: ServarrPayload): NormalizedAlert[] {
  if (!SERVARR_ALERT_EVENTS.has(payload.eventType)) return [];

  const instance = payload.instanceName ?? "servarr";
  const source = `servarr:${instance.toLowerCase()}`;

  if (payload.eventType === "ApplicationUpdate") {
    return [
      {
        source,
        source_id: `${source}:update:${payload.newVersion ?? "unknown"}`,
        service_name: instance,
        title: `${instance} updated from ${payload.previousVersion ?? "?"} to ${payload.newVersion ?? "?"}`,
        severity: "info",
        status: "firing",
        metadata: {
          eventType: payload.eventType,
          previousVersion: payload.previousVersion,
          newVersion: payload.newVersion,
          appUrl: payload.appUrl,
        },
      },
    ];
  }

  // Health / HealthRestored
  const isResolved = payload.eventType === "HealthRestored" || payload.isHealthy === true;

  if (!payload.messages?.length) {
    return [
      {
        source,
        source_id: `${source}:health:general`,
        service_name: instance,
        title: isResolved
          ? `${instance} health restored`
          : `${instance} health issue`,
        severity: "warning",
        status: isResolved ? "resolved" : "firing",
        metadata: {
          eventType: payload.eventType,
          reason: payload.reason,
          appUrl: payload.appUrl,
        },
      },
    ];
  }

  return payload.messages.map((msg, idx) => ({
    source,
    source_id: `${source}:health:${msg.source ?? idx}`,
    service_name: instance,
    title: msg.message || `${instance} health issue`,
    severity: mapServarrSeverity(msg.level, msg.type),
    status: isResolved ? "resolved" as const : "firing" as const,
    metadata: {
      eventType: payload.eventType,
      reason: payload.reason,
      messageSource: msg.source,
      wikiUrl: msg.wikiUrl,
      appUrl: payload.appUrl,
    },
  }));
}

/* ------------------------------------------------------------------ */
/*  Route factories                                                    */
/* ------------------------------------------------------------------ */

export function createAlertmanagerRoute(config: {
  alertChannelId: string;
}): WebhookRoute {
  return {
    method: "POST",
    path: "/webhooks/alertmanager",
    handler: async (request: unknown, reply: unknown) => {
      const alerts = normalizeAlertmanager(
        (request as { body: AlertmanagerPayload }).body,
      );
      for (const alert of alerts) {
        processAlert(alert, { alertChannelId: config.alertChannelId });
      }
      (reply as { code: (n: number) => { send: (b: unknown) => void } })
        .code(200)
        .send({ received: alerts.length });
    },
  };
}

export function createGrafanaRoute(config: {
  alertChannelId: string;
}): WebhookRoute {
  return {
    method: "POST",
    path: "/webhooks/grafana",
    handler: async (request: unknown, reply: unknown) => {
      const alerts = normalizeGrafana(
        (request as { body: GrafanaPayload }).body,
      );
      for (const alert of alerts) {
        processAlert(alert, { alertChannelId: config.alertChannelId });
      }
      (reply as { code: (n: number) => { send: (b: unknown) => void } })
        .code(200)
        .send({ received: alerts.length });
    },
  };
}

export function createInfluxRoute(config: {
  alertChannelId: string;
}): WebhookRoute {
  return {
    method: "POST",
    path: "/webhooks/influxdb",
    handler: async (request: unknown, reply: unknown) => {
      const alerts = normalizeInflux(
        (request as { body: InfluxPayload }).body,
      );
      for (const alert of alerts) {
        processAlert(alert, { alertChannelId: config.alertChannelId });
      }
      (reply as { code: (n: number) => { send: (b: unknown) => void } })
        .code(200)
        .send({ received: alerts.length });
    },
  };
}

export function createServarrRoute(config: {
  alertChannelId: string;
}): WebhookRoute {
  return {
    method: "POST",
    path: "/webhooks/servarr",
    handler: async (request: unknown, reply: unknown) => {
      const payload = (request as { body: ServarrPayload }).body;
      const alerts = normalizeServarr(payload);
      if (alerts.length === 0) {
        (reply as { code: (n: number) => { send: (b: unknown) => void } })
          .code(200)
          .send({ received: 0, skipped: payload.eventType });
        return;
      }
      for (const alert of alerts) {
        processAlert(alert, { alertChannelId: config.alertChannelId });
      }
      (reply as { code: (n: number) => { send: (b: unknown) => void } })
        .code(200)
        .send({ received: alerts.length });
    },
  };
}
