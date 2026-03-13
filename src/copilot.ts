import os from "os";
import path from "path";
import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";

// Truncate long responses to Discord's 2000-char limit
export function truncateForDiscord(text: string): string {
  if (text.length <= 1990) return text;
  return text.slice(0, 1990) + "\n…*(response truncated)*";
}

export class SessionManager {
  private client: CopilotClient;
  // Stores settled sessions for established users
  private sessions: Map<string, CopilotSession> = new Map();
  // Stores in-flight creation promises to prevent duplicate session creation (TOCTOU fix)
  private pending: Map<string, Promise<CopilotSession>> = new Map();

  constructor() {
    this.client = new CopilotClient();
  }

  private async getOrCreateSession(userId: string): Promise<CopilotSession> {
    // Return already-established session
    const existing = this.sessions.get(userId);
    if (existing) return existing;

    // If creation is already in flight for this user, wait for it (race condition fix)
    const inFlight = this.pending.get(userId);
    if (inFlight) return inFlight;

    // Start creation and register the promise immediately so concurrent calls wait
    const userSkillsDir = path.join(os.homedir(), ".agents", "skills");
    const creation = this.client
      .createSession({
        model: "claude-haiku-4.5",
        // Approve all tool/permission requests. This bot runs on a private server;
        // restrict access at the Discord server/channel level if needed.
        onPermissionRequest: approveAll,
        // Always load user-scope skills from ~/.agents/skills
        skillDirectories: [userSkillsDir],
      })
      .then((session) => {
        this.sessions.set(userId, session);
        this.pending.delete(userId);
        return session;
      })
      .catch((err) => {
        this.pending.delete(userId);
        throw err;
      });

    this.pending.set(userId, creation);
    return creation;
  }

  async sendMessage(userId: string, prompt: string): Promise<string> {
    const session = await this.getOrCreateSession(userId);
    const result = await session.sendAndWait({ prompt }, 5 * 60 * 1000); // 5-minute timeout
    return result?.data?.content ?? "(no response)";
  }

  async listModels() {
    await this.client.start(); // listModels() requires an active connection; start() is idempotent
    return this.client.listModels();
  }

  async setModel(userId: string, model: string): Promise<void> {
    const session = await this.getOrCreateSession(userId);
    await session.setModel(model);
  }

  async resetSession(userId: string): Promise<void> {
    // Delete from map FIRST so new requests don't pick up the dying session
    const session = this.sessions.get(userId);
    this.sessions.delete(userId);
    this.pending.delete(userId);
    if (session) {
      await session.disconnect().catch((err) =>
        console.error(`[SessionManager] Error disconnecting session for ${userId}:`, err)
      );
    }
  }

  async shutdown(): Promise<void> {
    const allSessions = Array.from(this.sessions.values());
    this.sessions.clear();
    this.pending.clear();
    await Promise.all(
      allSessions.map((s) =>
        s.disconnect().catch((err) => console.error("[SessionManager] Shutdown error:", err))
      )
    );
    await this.client.stop();
  }
}
