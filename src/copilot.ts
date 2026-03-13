import fs from "fs";
import os from "os";
import path from "path";
import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";

// Truncate long responses to Discord's 2000-char limit
export function truncateForDiscord(text: string): string {
  if (text.length <= 1990) return text;
  return text.slice(0, 1990) + "\n…*(response truncated)*";
}

/**
 * Persists the mapping of Discord session keys (user ID or thread ID) to
 * Copilot session IDs so sessions can be resumed after a bot restart.
 *
 * The Copilot CLI already keeps session data on disk; we only need to store
 * the ID lookup. Uses synchronous I/O since the file is tiny (<1 KB).
 */
class SessionStore {
  private readonly filePath: string;
  private data: Record<string, string> = {};

  constructor() {
    this.filePath = path.join(os.homedir(), ".config", "ai-assistant", "sessions.json");
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      this.data = JSON.parse(raw);
    } catch {
      // File missing or malformed — start fresh
      this.data = {};
    }
  }

  get(key: string): string | undefined {
    return this.data[key];
  }

  set(key: string, sessionId: string): void {
    if (this.data[key] === sessionId) return; // skip disk write if unchanged (e.g., normal resume)
    this.data[key] = sessionId;
    this.persist();
  }

  delete(key: string): void {
    delete this.data[key];
    this.persist();
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = this.filePath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.filePath); // atomic replace — no partial-write corruption
    } catch (err) {
      console.error("[SessionStore] Failed to persist sessions:", err);
    }
  }
}

export class SessionManager {
  private client: CopilotClient;
  // Stores settled sessions for established users
  private sessions: Map<string, CopilotSession> = new Map();
  // Stores in-flight creation promises to prevent duplicate session creation (TOCTOU fix)
  private pending: Map<string, Promise<CopilotSession>> = new Map();
  // Serializes concurrent sendMessage calls per session to prevent state corruption
  private messageQueues: Map<string, Promise<unknown>> = new Map();
  // Persists Discord key → Copilot session ID across restarts
  private store: SessionStore = new SessionStore();

  constructor() {
    this.client = new CopilotClient();
  }

  private async getOrCreateSession(key: string): Promise<CopilotSession> {
    // Return already-established in-memory session
    const existing = this.sessions.get(key);
    if (existing) return existing;

    // If creation/resumption is already in flight, wait for it (race condition fix)
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const userSkillsDir = path.join(os.homedir(), ".agents", "skills");
    const sessionConfig = {
      onPermissionRequest: approveAll,
      skillDirectories: [userSkillsDir] as string[],
    };

    const storedSessionId = this.store.get(key);

    const creation = (
      storedSessionId
        ? // Try to resume the existing Copilot session from disk
          this.client
            .resumeSession(storedSessionId, sessionConfig)
            .catch((err) => {
              console.warn(
                `[SessionManager] Resume failed for ${key} (${storedSessionId}), creating new session:`,
                err
              );
              return this.client.createSession({ model: "claude-haiku-4.5", ...sessionConfig });
            })
        : this.client.createSession({ model: "claude-haiku-4.5", ...sessionConfig })
    ).then((session) => {
      // Guard: if resetSession removed our pending entry while we were in flight,
      // don't resurrect the session — disconnect it and skip persisting.
      // The in-flight caller still gets the session for their one message, but
      // it won't be cached or written to disk for future calls.
      if (this.pending.get(key) !== creation) {
        session.disconnect().catch(() => {});
        return session;
      }
      this.sessions.set(key, session);
      this.pending.delete(key);
      this.store.set(key, session.sessionId);
      return session;
    }).catch((err) => {
      // Guard: only clean up our own pending entry, not one started after us
      if (this.pending.get(key) === creation) {
        this.pending.delete(key);
      }
      throw err;
    });

    this.pending.set(key, creation);
    return creation;
  }

  async sendMessage(userId: string, prompt: string): Promise<string> {
    const tail = this.messageQueues.get(userId) ?? Promise.resolve();
    const next = tail.then(async () => {
      const session = await this.getOrCreateSession(userId);
      const result = await session.sendAndWait({ prompt }, 5 * 60 * 1000); // 5-minute timeout
      return result?.data?.content ?? "(no response)";
    });
    // Non-rejecting tail so errors don't permanently block the queue
    this.messageQueues.set(userId, next.catch(() => {}));
    return next;
  }

  async getStatus() {
    await this.client.start();
    const [status, authStatus] = await Promise.all([
      this.client.getStatus(),
      this.client.getAuthStatus(),
    ]);
    return { status, authStatus };
  }

  async getHistory(userId: string) {
    const session = this.sessions.get(userId);
    if (!session) return null;
    return session.getMessages();
  }

  async listModels() {
    await this.client.start(); // listModels() requires an active connection; start() is idempotent
    return this.client.listModels();
  }

  async setModel(userId: string, model: string): Promise<void> {
    const session = await this.getOrCreateSession(userId);
    await session.setModel(model);
  }

  async resetSession(key: string): Promise<void> {
    const session = this.sessions.get(key);
    const storedSessionId = this.store.get(key);

    // Remove from all in-memory structures first so new requests start fresh
    this.sessions.delete(key);
    this.pending.delete(key);
    this.messageQueues.delete(key);
    this.store.delete(key);

    // Disconnect the live session if present (frees in-process resources)
    if (session) {
      await session.disconnect().catch((err) =>
        console.error(`[SessionManager] Error disconnecting session for ${key}:`, err)
      );
    }

    // Permanently delete from Copilot's disk store so it can't be resumed
    const sessionId = session?.sessionId ?? storedSessionId;
    if (sessionId) {
      await this.client.start();
      await this.client.deleteSession(sessionId).catch((err) =>
        console.error(`[SessionManager] Error deleting session ${sessionId}:`, err)
      );
    }
  }

  async shutdown(): Promise<void> {
    const allSessions = Array.from(this.sessions.values());
    this.sessions.clear();
    this.pending.clear();
    // disconnect() preserves session data on disk for resume on next start
    await Promise.all(
      allSessions.map((s) =>
        s.disconnect().catch((err) => console.error("[SessionManager] Shutdown error:", err))
      )
    );
    await this.client.stop();
  }
}
