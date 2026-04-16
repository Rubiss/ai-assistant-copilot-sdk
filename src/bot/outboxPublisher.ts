import type { Client, TextChannel } from "discord.js";
import { claimPending, markDelivered, markFailed, setThreadId } from "../app/store/outbox.js";
import type { OutboxMessage } from "../app/store/outbox.js";

export interface OutboxPublisherOptions {
  pollIntervalMs?: number;
}

export class OutboxPublisher {
  private client: Client;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pollIntervalMs: number;

  constructor(client: Client, options: OutboxPublisherOptions = {}) {
    this.client = client;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[outbox] Publisher started (poll every ${this.pollIntervalMs}ms)`);
    // Do an initial poll immediately
    this.poll().catch((err) => console.error("[outbox] Poll error:", err));
    this.timer = setInterval(() => {
      this.poll().catch((err) => console.error("[outbox] Poll error:", err));
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[outbox] Publisher stopped.");
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

  private async deliver(msg: OutboxMessage): Promise<void> {
    const channel = await this.client.channels.fetch(msg.channel_id);
    if (!channel || !("send" in channel)) {
      throw new Error(`Channel ${msg.channel_id} not found or not text-based`);
    }

    const textChannel = channel as TextChannel;
    const payload = msg.payload as { content?: string; embeds?: unknown[] };

    // If this is an alert and no thread exists, create one
    if (msg.message_type === "alert" && !msg.thread_id) {
      const threadName = (payload.content ?? "Alert").slice(0, 100);
      const sent = await textChannel.send(payload as any);
      const thread = await sent.startThread({
        name: threadName,
        autoArchiveDuration: 1440, // 24 hours
      });
      setThreadId(msg.id, thread.id);
      return;
    }

    // If we have a thread_id, send to the thread
    if (msg.thread_id) {
      const thread = await this.client.channels.fetch(msg.thread_id);
      if (thread && "send" in thread) {
        await (thread as TextChannel).send(payload as any);
        return;
      }
    }

    // Default: send to channel
    await textChannel.send(payload as any);
  }
}
