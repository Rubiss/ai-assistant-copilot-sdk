import { getEvents } from "../../adapters/docker.js";
import { processAlert } from "../../worker/incidentEngine.js";
/* ------------------------------------------------------------------ */
/*  Normalize Docker events into alerts                                */
/* ------------------------------------------------------------------ */
function normalizeDockerEvent(event) {
    const containerName = event.Actor.Attributes.name ?? event.Actor.ID.slice(0, 12);
    const image = event.Actor.Attributes.image ?? "unknown";
    switch (event.Action) {
        case "die":
            return {
                source: "docker",
                source_id: `docker:die:${event.Actor.ID}:${event.time}`,
                service_name: containerName,
                title: `Container ${containerName} died (exit ${event.Actor.Attributes.exitCode ?? "?"})`,
                severity: "critical",
                status: "firing",
                metadata: {
                    action: "die",
                    containerId: event.Actor.ID,
                    image,
                    exitCode: event.Actor.Attributes.exitCode,
                },
            };
        case "oom":
            return {
                source: "docker",
                source_id: `docker:oom:${event.Actor.ID}:${event.time}`,
                service_name: containerName,
                title: `Container ${containerName} killed by OOM`,
                severity: "critical",
                status: "firing",
                metadata: { action: "oom", containerId: event.Actor.ID, image },
            };
        case "restart":
            return {
                source: "docker",
                source_id: `docker:restart:${event.Actor.ID}:${event.time}`,
                service_name: containerName,
                title: `Container ${containerName} restarted`,
                severity: "warning",
                status: "firing",
                metadata: { action: "restart", containerId: event.Actor.ID, image },
            };
        case "health_status: unhealthy":
            return {
                source: "docker",
                source_id: `docker:unhealthy:${event.Actor.ID}`,
                service_name: containerName,
                title: `Container ${containerName} is unhealthy`,
                severity: "warning",
                status: "firing",
                metadata: {
                    action: "health_status",
                    containerId: event.Actor.ID,
                    image,
                    healthStatus: "unhealthy",
                },
            };
        case "health_status: healthy":
            return {
                source: "docker",
                source_id: `docker:unhealthy:${event.Actor.ID}`,
                service_name: containerName,
                title: `Container ${containerName} is healthy again`,
                severity: "info",
                status: "resolved",
                metadata: {
                    action: "health_status",
                    containerId: event.Actor.ID,
                    image,
                    healthStatus: "healthy",
                },
            };
        default:
            return null;
    }
}
/* ------------------------------------------------------------------ */
/*  Watcher factory                                                    */
/* ------------------------------------------------------------------ */
export function createDockerWatcher(config) {
    return {
        name: "docker-events",
        start: async () => {
            const { stream, abort } = getEvents({
                type: ["container"],
                event: ["die", "oom", "restart", "health_status"],
            });
            const consume = async () => {
                try {
                    for await (const event of stream) {
                        const alert = normalizeDockerEvent(event);
                        if (alert) {
                            try {
                                processAlert(alert, config);
                            }
                            catch (err) {
                                console.error("[docker-watcher] Error processing event:", err);
                            }
                        }
                    }
                }
                catch (err) {
                    console.error("[docker-watcher] Event stream error:", err);
                }
            };
            consume();
            return () => {
                abort();
            };
        },
    };
}
