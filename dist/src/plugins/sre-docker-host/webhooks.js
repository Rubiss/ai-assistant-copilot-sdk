import { processAlert } from "../../worker/incidentEngine.js";
export function mapAlertmanagerSeverity(severity) {
    if (severity === "critical" || severity === "error")
        return "critical";
    if (severity === "warning")
        return "warning";
    return "info";
}
export function normalizeAlertmanager(payload) {
    return payload.alerts.map((alert) => ({
        source: "alertmanager",
        source_id: `alertmanager:${alert.fingerprint}`,
        service_name: alert.labels.service ?? alert.labels.job ?? alert.labels.instance,
        title: alert.annotations.summary ??
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
export function mapGrafanaSeverity(severity) {
    if (severity === "critical" || severity === "error")
        return "critical";
    if (severity === "warning")
        return "warning";
    return "info";
}
export function normalizeGrafana(payload) {
    return payload.alerts.map((alert) => ({
        source: "grafana",
        source_id: `grafana:${alert.fingerprint}`,
        service_name: alert.labels.service ?? alert.labels.grafana_folder,
        title: alert.annotations.summary ??
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
export function mapInfluxSeverity(level) {
    if (level === "crit")
        return "critical";
    if (level === "warn")
        return "warning";
    return "info";
}
export function normalizeInflux(payload) {
    const status = payload._level === "ok" ? "resolved" : "firing";
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
/*  Route factories                                                    */
/* ------------------------------------------------------------------ */
export function createAlertmanagerRoute(config) {
    return {
        method: "POST",
        path: "/webhooks/alertmanager",
        handler: async (request, reply) => {
            const alerts = normalizeAlertmanager(request.body);
            for (const alert of alerts) {
                processAlert(alert, { alertChannelId: config.alertChannelId });
            }
            reply
                .code(200)
                .send({ received: alerts.length });
        },
    };
}
export function createGrafanaRoute(config) {
    return {
        method: "POST",
        path: "/webhooks/grafana",
        handler: async (request, reply) => {
            const alerts = normalizeGrafana(request.body);
            for (const alert of alerts) {
                processAlert(alert, { alertChannelId: config.alertChannelId });
            }
            reply
                .code(200)
                .send({ received: alerts.length });
        },
    };
}
export function createInfluxRoute(config) {
    return {
        method: "POST",
        path: "/webhooks/influxdb",
        handler: async (request, reply) => {
            const alerts = normalizeInflux(request.body);
            for (const alert of alerts) {
                processAlert(alert, { alertChannelId: config.alertChannelId });
            }
            reply
                .code(200)
                .send({ received: alerts.length });
        },
    };
}
