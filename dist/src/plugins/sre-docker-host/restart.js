import * as docker from "../../adapters/docker.js";
import { addTimelineEvent } from "../../worker/incidentEngine.js";
import * as outbox from "../../app/store/outbox.js";
import { logAudit } from "../../app/store/audit.js";
/* ------------------------------------------------------------------ */
/*  Cooldown tracking                                                  */
/* ------------------------------------------------------------------ */
const lastRestartTimes = new Map();
/* ------------------------------------------------------------------ */
/*  Restart flow                                                       */
/* ------------------------------------------------------------------ */
export async function restartService(containerId, containerName, incidentId, config) {
    // Pre-check: allowlist
    if (!config.allowlist.includes(containerName) &&
        !config.allowlist.includes("*")) {
        return {
            success: false,
            message: `Service ${containerName} is not in the restart allowlist`,
        };
    }
    // Pre-check: cooldown
    const lastRestart = lastRestartTimes.get(containerName);
    if (lastRestart && Date.now() - lastRestart < config.cooldownMs) {
        const remaining = Math.ceil((config.cooldownMs - (Date.now() - lastRestart)) / 1000);
        return {
            success: false,
            message: `Cooldown active for ${containerName} (${remaining}s remaining)`,
        };
    }
    // Execute restart
    try {
        await docker.restartContainer(containerId, 10);
        lastRestartTimes.set(containerName, Date.now());
        // Verify health after restart (poll for up to 30s)
        let healthy = false;
        for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 5000));
            try {
                const inspect = await docker.inspectContainer(containerId);
                if (inspect.State.Running &&
                    (!inspect.State.Health ||
                        inspect.State.Health.Status === "healthy")) {
                    healthy = true;
                    break;
                }
            }
            catch {
                /* container might not be ready */
            }
        }
        const message = healthy
            ? `Successfully restarted ${containerName} — service is healthy`
            : `Restarted ${containerName} — waiting for healthy status`;
        // Record in incident timeline
        if (incidentId) {
            addTimelineEvent(incidentId, {
                event_type: "action_executed",
                actor: "worker",
                content: message,
            });
        }
        // Notify via outbox
        outbox.insertOutboxMessage({
            channel_id: config.alertChannelId,
            message_type: "update",
            payload: { content: `⚡ ${message}` },
        });
        try {
            logAudit({
                process: "worker",
                event_type: "container_restart",
                target: containerName,
                detail: { containerId, incidentId, healthy },
            });
        }
        catch {
            /* best-effort */
        }
        return { success: true, message };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (incidentId) {
            addTimelineEvent(incidentId, {
                event_type: "action_failed",
                actor: "worker",
                content: `Restart failed: ${error}`,
            });
        }
        return { success: false, message: `Restart failed: ${error}` };
    }
}
