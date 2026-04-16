import * as incidents from "../../app/store/incidents.js";
import * as outbox from "../../app/store/outbox.js";
import * as docker from "../../adapters/docker.js";
/* ------------------------------------------------------------------ */
/*  Daily health report                                                */
/* ------------------------------------------------------------------ */
export function createDailyReport(alertChannelId) {
    return {
        name: "daily-health-report",
        intervalMs: 24 * 60 * 60 * 1000,
        run: async () => {
            const openIncidents = incidents.listIncidents("open");
            const ackedIncidents = incidents.listIncidents("acknowledged");
            let containerSummary = "Docker unavailable";
            try {
                const containers = await docker.listContainers(true);
                const running = containers.filter((c) => c.State === "running").length;
                const stopped = containers.filter((c) => c.State !== "running").length;
                containerSummary = `${running} running, ${stopped} stopped`;
            }
            catch {
                /* Docker not available */
            }
            outbox.insertOutboxMessage({
                channel_id: alertChannelId,
                message_type: "report",
                payload: {
                    content: null,
                    embeds: [
                        {
                            title: "📋 Daily Health Report",
                            color: 0x3498db,
                            fields: [
                                {
                                    name: "Open Incidents",
                                    value: String(openIncidents.length),
                                    inline: true,
                                },
                                {
                                    name: "Acknowledged",
                                    value: String(ackedIncidents.length),
                                    inline: true,
                                },
                                {
                                    name: "Containers",
                                    value: containerSummary,
                                    inline: true,
                                },
                            ],
                            timestamp: new Date().toISOString(),
                        },
                    ],
                },
            });
        },
    };
}
/* ------------------------------------------------------------------ */
/*  Weekly summary report                                              */
/* ------------------------------------------------------------------ */
export function createWeeklyReport(alertChannelId) {
    return {
        name: "weekly-summary-report",
        intervalMs: 7 * 24 * 60 * 60 * 1000,
        run: async () => {
            const allIncidents = incidents.listIncidents();
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const recentIncidents = allIncidents.filter((i) => i.created_at >= weekAgo);
            const resolved = recentIncidents.filter((i) => i.status === "resolved" || i.status === "closed");
            outbox.insertOutboxMessage({
                channel_id: alertChannelId,
                message_type: "report",
                payload: {
                    content: null,
                    embeds: [
                        {
                            title: "📊 Weekly Summary Report",
                            color: 0x9b59b6,
                            fields: [
                                {
                                    name: "Total Incidents",
                                    value: String(recentIncidents.length),
                                    inline: true,
                                },
                                {
                                    name: "Resolved",
                                    value: String(resolved.length),
                                    inline: true,
                                },
                                {
                                    name: "Still Open",
                                    value: String(recentIncidents.length - resolved.length),
                                    inline: true,
                                },
                            ],
                            timestamp: new Date().toISOString(),
                        },
                    ],
                },
            });
        },
    };
}
