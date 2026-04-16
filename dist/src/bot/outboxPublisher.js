import { claimPending, markDelivered, markFailed, setThreadId } from "../app/store/outbox.js";
import { setThreadId as setIncidentThreadId } from "../app/store/incidents.js";
export class OutboxPublisher {
    client;
    timer = null;
    running = false;
    polling = false;
    pollIntervalMs;
    constructor(client, options = {}) {
        this.client = client;
        this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        console.log(`[outbox] Publisher started (poll every ${this.pollIntervalMs}ms)`);
        this.scheduleNextPoll(0);
    }
    stop() {
        if (!this.running)
            return;
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        console.log("[outbox] Publisher stopped.");
    }
    scheduleNextPoll(delayMs) {
        if (!this.running)
            return;
        this.timer = setTimeout(async () => {
            if (this.polling)
                return;
            this.polling = true;
            try {
                await this.poll();
            }
            catch (err) {
                console.error("[outbox] Poll error:", err);
            }
            finally {
                this.polling = false;
                this.scheduleNextPoll(this.pollIntervalMs);
            }
        }, delayMs);
    }
    async poll() {
        const messages = claimPending(10);
        if (messages.length === 0)
            return;
        for (const msg of messages) {
            try {
                await this.deliver(msg);
                markDelivered(msg.id);
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                console.error(`[outbox] Failed to deliver message ${msg.id}:`, error);
                markFailed(msg.id, error);
            }
        }
    }
    formatMessage(msg) {
        const payload = msg.payload;
        switch (msg.message_type) {
            case "alert": {
                // Already formatted as embed from incident engine — validate embeds exist
                const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
                return { content: payload.content ?? undefined, embeds };
            }
            case "report": {
                const title = payload.title ?? "Report";
                const description = payload.content ?? payload.description ?? "";
                return {
                    embeds: [
                        {
                            title,
                            description,
                            color: 0x3498db,
                            timestamp: new Date().toISOString(),
                        },
                    ],
                };
            }
            case "update": {
                // Simple text for thread replies (status changes, notes)
                return { content: payload.content ?? "Update" };
            }
            case "summary": {
                const summaryTitle = payload.title ?? "Summary";
                const summaryDesc = payload.description ?? payload.content ?? "";
                const fields = Array.isArray(payload.fields) ? payload.fields : [];
                return {
                    embeds: [
                        {
                            title: summaryTitle,
                            description: summaryDesc,
                            color: 0x2ecc71,
                            fields,
                            timestamp: new Date().toISOString(),
                        },
                    ],
                };
            }
            case "approval_request": {
                // Pass through embeds and components for interactive buttons
                const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
                const components = Array.isArray(payload.components) ? payload.components : [];
                return { content: payload.content ?? undefined, embeds, components };
            }
            default:
                return payload;
        }
    }
    async deliver(msg) {
        const channel = await this.client.channels.fetch(msg.channel_id);
        if (!channel || !("send" in channel)) {
            throw new Error(`Channel ${msg.channel_id} not found or not text-based`);
        }
        const sendable = channel;
        const formatted = this.formatMessage(msg);
        const payload = msg.payload;
        // If this is an alert and no thread exists, create one
        if (msg.message_type === "alert" && !msg.thread_id) {
            // Derive thread name from embed title if available
            const embeds = Array.isArray(formatted.embeds) ? formatted.embeds : [];
            const embedTitle = embeds[0]?.title;
            const threadName = (embedTitle ?? formatted.content ?? "Alert").slice(0, 100);
            // Thread creation happens on the sent Message, not the Channel
            const sent = await sendable.send(formatted);
            const thread = await sent.startThread({
                name: threadName,
                autoArchiveDuration: 1440,
            });
            setThreadId(msg.id, thread.id);
            // Link thread to incident if incident_id is available in metadata
            const metadata = payload.metadata;
            const incidentId = metadata?.incident_id;
            if (incidentId) {
                try {
                    setIncidentThreadId(incidentId, thread.id);
                }
                catch { /* best-effort */ }
            }
            return;
        }
        // If we have a thread_id, send to the thread (may be ThreadChannel, not TextChannel)
        if (msg.thread_id) {
            const thread = await this.client.channels.fetch(msg.thread_id);
            if (thread && "send" in thread) {
                await thread.send(formatted);
                return;
            }
        }
        // Default: send to channel
        await sendable.send(formatted);
    }
}
