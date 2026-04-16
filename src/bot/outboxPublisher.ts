import type { Client, TextChannel } from "discord.js";
import { claimPending, markDelivered, markFailed, setThreadId } from "../app/store/outbox.js";
import type { OutboxMessage } from "../app/store/outbox.js";
import { setThreadId as setIncidentThreadId } from "../app/store/incidents.js";

export interface OutboxPublisherOptions {
  pollIntervalMs?: number;
}

export class OutboxPublisher {
  private client: Client;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private polling = false;
  private pollIntervalMs: number;

  constructor(client: Client, options: OutboxPublisherOptions = {}) {
    this.client = client;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[outbox] Publisher started (poll every ${this.pollIntervalMs}ms)`);
    this.scheduleNextPoll(0);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[outbox] Publisher stopped.");
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      if (this.polling) return;
      this.polling = true;
      try {
        await this.poll();
      } catch (err) {
        console.error("[outbox] Poll error:", err);
      } finally {
        this.polling = false;
        this.scheduleNextPoll(this.pollIntervalMs);
      }
    }, delayMs);
  }

  private async poll(): Promise<void> {
    const messages = claimPending(10);
    if (messages.length === 0) return;

    for (const msg of messages) {
      try {
        await this.deliver(msg);
        markDelivered(msg.id);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[outbox] Failed to deliver message ${msg.id}:`, error);
        markFailed(msg.id, error);
      }
    }
  }

  private formatMessage(msg: OutboxMessage): Record<string, unknown> {
    const payload = msg.payload as Record<string, unknown>;

    switch (msg.message_type) {
      case "alert": {
        // Already formatted as embed from incident engine — validate embeds exist
        const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
        return { content: (payload.content as string) ?? undefined, embeds };
      }

      case "report": {
        const title = (payload.title as string) ?? "Report";
        const description = (payload.content as string) ?? (payload.description as string) ?? "";
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
        return { content: (payload.content as string) ?? "Update" };
      }

      case "summary": {
        const summaryTitle = (payload.title as string) ?? "Summary";
        const summaryDesc = (payload.description as string) ?? (payload.content as string) ?? "";
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
        return { content: (payload.content as string) ?? undefined, embeds, components };
      }

      default:
        return payload;
    }
  }

  private async deliver(msg: OutboxMessage): Promise<void> {
    const channel = await this.client.channels.fetch(msg.channel_id);
    if (!channel || !("send" in channel)) {
      throw new Error(`Channel ${msg.channel_id} not found or not text-based`);
    }

    const sendable = channel as TextChannel;
    const formatted = this.formatMessage(msg);
    const payload = msg.payload as Record<string, unknown>;

    // If this is an alert and no thread exists, create one
    if (msg.message_type === "alert" && !msg.thread_id) {
      // Derive thread name from embed title if available
      const embeds = Array.isArray(formatted.embeds) ? (formatted.embeds as Array<{ title?: string }>) : [];
      const embedTitle = embeds[0]?.title;
      const threadName = (embedTitle ?? (formatted.content as string) ?? "Alert").slice(0, 100);

      // Thread creation happens on the sent Message, not the Channel
      const sent = await sendable.send(formatted as Parameters<TextChannel["send"]>[0]);
      const thread = await sent.startThread({
        name: threadName,
        autoArchiveDuration: 1440,
      });
      setThreadId(msg.id, thread.id);

      // Link thread to incident if incident_id is available in metadata
      const metadata = payload.metadata as Record<string, unknown> | undefined;
      const incidentId = metadata?.incident_id as string | undefined;
      if (incidentId) {
        try { setIncidentThreadId(incidentId, thread.id); } catch { /* best-effort */ }
      }
      return;
    }

    // If we have a thread_id, send to the thread (may be ThreadChannel, not TextChannel)
    if (msg.thread_id) {
      const thread = await this.client.channels.fetch(msg.thread_id);
      if (thread && "send" in thread) {
        await (thread as unknown as Pick<TextChannel, "send">).send(
          formatted as Parameters<TextChannel["send"]>[0],
        );
        return;
      }
    }

    // Default: send to channel
    await sendable.send(formatted as Parameters<TextChannel["send"]>[0]);
  }
}
