import fs from "fs";
import os from "os";
import path from "path";
import { CopilotClient, CopilotSession, MCPServerConfig, approveAll } from "@github/copilot-sdk";

const DISCORD_MAX = 1990; // Leave headroom for code-fence close/reopen overhead

/**
 * Splits text into chunks that each fit within Discord's 2000-char message limit.
 * Splits at paragraph → newline → word boundaries to avoid mid-word cuts.
 * Tracks open code fences: closes the fence at the split point and reopens it
 * (with the same language tag) at the start of the next chunk.
 */
export function chunkForDiscord(text: string, maxLen = DISCORD_MAX): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Prefer clean boundaries in the back half of the window
    const half = Math.floor(maxLen / 2);
    let splitAt = maxLen;

    const paraBreak = remaining.lastIndexOf("\n\n", maxLen);
    if (paraBreak >= half) {
      splitAt = paraBreak + 2;
    } else {
      const lineBreak = remaining.lastIndexOf("\n", maxLen);
      if (lineBreak >= half) {
        splitAt = lineBreak + 1;
      } else {
        const wordBreak = remaining.lastIndexOf(" ", maxLen);
        if (wordBreak >= half) {
          splitAt = wordBreak + 1;
        }
      }
    }

    let chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);

    // Line-by-line toggle to detect open code fences at the split point.
    // A ``` line opens a fence (capturing the language tag); a closing ``` line
    // (no language tag) closes it. Handles unlabeled fences correctly.
    let openFenceLang: string | null = null;
    for (const line of chunk.split("\n")) {
      const m = line.match(/^```(\S*)\s*$/);
      if (!m) continue;
      const lang = m[1];
      if (openFenceLang === null) {
        openFenceLang = lang; // entering a fence (lang may be empty for unlabeled)
      } else if (lang === "") {
        openFenceLang = null; // valid closer has no language tag
      }
      // A tagged ``` while already inside a fence is ignored (unusual edge case)
    }

    if (openFenceLang !== null) {
      chunk += "\n```";
      remaining = "```" + openFenceLang + "\n" + remaining;
    }

    chunks.push(chunk);
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
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

/**
 * Loads and merges MCP server configs from:
 *   1. ~/.config/Code/User/mcp.json  (global; "mcpServers" key)
 *   2. <workingDir>/.vscode/mcp.json (workspace; "servers" key)
 *
 * Workspace entries win on name conflict. The `tools: ["*"]` default is
 * injected when absent. Values matching `${input:xxx}` are resolved from
 * env vars named MCP_INPUT_<XXX> (uppercase, hyphens → underscores).
 * Servers that still contain unresolved `${input:...}` after resolution are
 * dropped and logged so the bot starts cleanly without crashing.
 */
export class McpConfigLoader {
  private static readonly GLOBAL_PATH =
    process.env.MCP_CONFIG_PATH ??
    path.join(os.homedir(), ".config", "Code", "User", "mcp.json");

  static load(workingDir?: string): Record<string, MCPServerConfig> {
    const global = this.readFile(this.GLOBAL_PATH, "mcpServers");
    const workspace = workingDir
      ? this.readFile(path.join(workingDir, ".vscode", "mcp.json"), "servers")
      : {};
    const merged = { ...global, ...workspace };
    return this.resolveAndFilter(merged);
  }

  private static readFile(
    filePath: string,
    key: string
  ): Record<string, unknown> {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const servers = parsed[key];
      if (servers && typeof servers === "object" && !Array.isArray(servers)) {
        return servers as Record<string, unknown>;
      }
    } catch {
      // Missing or malformed — silently skip
    }
    return {};
  }

  private static resolveAndFilter(
    raw: Record<string, unknown>
  ): Record<string, MCPServerConfig> {
    const result: Record<string, MCPServerConfig> = {};
    for (const [name, cfg] of Object.entries(raw)) {
      try {
        const resolved = this.resolveInputs(JSON.stringify(cfg));
        if (resolved === null) {
          console.warn(`[McpConfigLoader] Skipping "${name}": unresolved \${input:...} values`);
          continue;
        }
        const server = JSON.parse(resolved) as Record<string, unknown>;
        if (!Array.isArray(server["tools"])) server["tools"] = ["*"];
        result[name] = server as unknown as MCPServerConfig;
      } catch {
        console.warn(`[McpConfigLoader] Skipping "${name}": invalid config`);
      }
    }
    return result;
  }

  /** Returns null if any ${input:xxx} remain after env resolution. */
  private static resolveInputs(json: string): string | null {
    const resolved = json.replace(/\$\{input:([\w-]+)\}/g, (match, id: string) => {
      const envKey = "MCP_INPUT_" + id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      return process.env[envKey] ?? match;
    });
    return /\$\{input:[\w-]+\}/.test(resolved) ? null : resolved;
  }

  /** Returns per-server status including whether it was skipped. */
  static status(workingDir?: string): { name: string; source: string; enabled: boolean }[] {
    const globalRaw = this.readFile(this.GLOBAL_PATH, "mcpServers");
    const workspaceRaw = workingDir
      ? this.readFile(path.join(workingDir, ".vscode", "mcp.json"), "servers")
      : {};
    const merged = { ...globalRaw, ...workspaceRaw };

    return Object.keys(merged).map((name) => {
      const source = name in workspaceRaw ? "workspace" : "global";
      const resolved = this.resolveInputs(JSON.stringify(merged[name]));
      return { name, source, enabled: resolved !== null };
    });
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
  // Per-session working directory override (affects MCP loading and agent file ops)
  private workingDirOverrides: Map<string, string> = new Map();
  // Per-session MCP tool overrides: server name → tools array (["*"] = enabled, [] = disabled)
  private mcpToolOverrides: Map<string, Record<string, string[]>> = new Map();

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
    const workingDir = this.workingDirOverrides.get(key);
    const mcpServers = this.buildMcpConfig(key);
    const sessionConfig = {
      onPermissionRequest: approveAll,
      skillDirectories: [userSkillsDir] as string[],
      ...(workingDir ? { workingDirectory: workingDir } : {}),
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
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

  async sendMessage(
    userId: string,
    prompt: string,
    imagePaths?: Array<{ path: string; displayName?: string }>
  ): Promise<string> {
    const tail = this.messageQueues.get(userId) ?? Promise.resolve();
    const next = tail.then(async () => {
      const session = await this.getOrCreateSession(userId);
      const attachments = imagePaths?.map((a) => ({
        type: "file" as const,
        path: a.path,
        ...(a.displayName ? { displayName: a.displayName } : {}),
      }));
      const result = await session.sendAndWait(
        { prompt, ...(attachments?.length ? { attachments } : {}) },
        parseInt(process.env.COPILOT_TIMEOUT_MS ?? "") || 10 * 60 * 1000 // default 10-minute timeout
      );
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

  async getCurrentModel(key: string): Promise<string | undefined> {
    const session = await this.getOrCreateSession(key);
    const result = await session.rpc.model.getCurrent();
    return result.modelId;
  }

  // ── Agent management ────────────────────────────────────────────────────────

  async listAgents(key: string): Promise<{ name: string; displayName: string; description: string }[]> {
    const session = await this.getOrCreateSession(key);
    const result = await session.rpc.agent.list();
    return result.agents;
  }

  async getCurrentAgent(key: string): Promise<{ name: string; displayName: string; description: string } | null> {
    const session = await this.getOrCreateSession(key);
    const result = await session.rpc.agent.getCurrent();
    return result.agent ?? null;
  }

  async selectAgent(key: string, name: string): Promise<{ name: string; displayName: string; description: string }> {
    const session = await this.getOrCreateSession(key);
    const result = await session.rpc.agent.select({ name });
    return result.agent;
  }

  async deselectAgent(key: string): Promise<void> {
    const session = await this.getOrCreateSession(key);
    await session.rpc.agent.deselect();
  }

  // ── Session mode ─────────────────────────────────────────────────────────────

  async getMode(key: string): Promise<"interactive" | "plan" | "autopilot"> {
    const session = await this.getOrCreateSession(key);
    return session.rpc.mode.get();
  }

  async setMode(key: string, mode: "interactive" | "plan" | "autopilot"): Promise<void> {
    const session = await this.getOrCreateSession(key);
    await session.rpc.mode.set({ mode });
  }

  // ── Compaction ───────────────────────────────────────────────────────────────

  async compact(key: string): Promise<{ success: boolean; tokensRemoved: number; messagesRemoved: number }> {
    const session = await this.getOrCreateSession(key);
    return session.rpc.history.compact();
  }

  // ── Fleet ────────────────────────────────────────────────────────────────────

  async startFleet(key: string, prompt?: string): Promise<boolean> {
    const session = await this.getOrCreateSession(key);
    const result = await session.rpc.fleet.start({ prompt });
    return result.started;
  }

  // ── Plan management ──────────────────────────────────────────────────────────

  async readPlan(key: string): Promise<{ exists: boolean; content: string | null; path: string | null }> {
    const session = await this.getOrCreateSession(key);
    return session.rpc.plan.read();
  }

  async updatePlan(key: string, content: string): Promise<void> {
    const session = await this.getOrCreateSession(key);
    await session.rpc.plan.update({ content });
  }

  async deletePlan(key: string): Promise<void> {
    const session = await this.getOrCreateSession(key);
    await session.rpc.plan.delete();
  }

  // ── Workspace management ─────────────────────────────────────────────────────

  async listWorkspaceFiles(key: string): Promise<string[]> {
    const session = await this.getOrCreateSession(key);
    const result = await session.rpc.workspaces.listFiles();
    return result.files;
  }

  async readWorkspaceFile(key: string, filePath: string): Promise<string> {
    const session = await this.getOrCreateSession(key);
    const result = await session.rpc.workspaces.readFile({ path: filePath });
    return result.content;
  }

  async createWorkspaceFile(key: string, filePath: string, content: string): Promise<void> {
    const session = await this.getOrCreateSession(key);
    await session.rpc.workspaces.createFile({ path: filePath, content });
  }

  async resetSession(key: string): Promise<void> {
    const session = this.sessions.get(key);
    const storedSessionId = this.store.get(key);

    // Remove from all in-memory structures first so new requests start fresh
    this.sessions.delete(key);
    this.pending.delete(key);
    this.messageQueues.delete(key);
    this.store.delete(key);
    // Preserve working dir and MCP overrides across reset so users don't have
    // to re-configure after /reset — they can clear them explicitly via /mcp

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

  // --- MCP + Working Directory management ---

  /** Build the mcpServers config for session creation by merging base config with session overrides. */
  private buildMcpConfig(key: string): Record<string, MCPServerConfig> {
    const workingDir = this.workingDirOverrides.get(key);
    const base = McpConfigLoader.load(workingDir);
    const overrides = this.mcpToolOverrides.get(key) ?? {};
    const result: Record<string, MCPServerConfig> = {};
    for (const [name, cfg] of Object.entries(base)) {
      if (name in overrides) {
        result[name] = { ...cfg, tools: overrides[name] };
      } else {
        result[name] = cfg;
      }
    }
    // Servers skipped due to unresolved ${input:...} are absent from base and
    // cannot be added here regardless of overrides — they remain unavailable
    // until their env vars are set and the session is reset.
    return result;
  }

  /** Set the working directory for a session. Takes effect when the session is (re)created.
   * Throws if the path is invalid, does not exist, or is not a directory.
   * Symlinks are fully resolved so the stored path is always a stable canonical target. */
  setSessionWorkingDir(key: string, dir: string): void {
    if (!dir || dir.includes("\0")) {
      throw new Error("Invalid workspace path.");
    }
    let canonical: string;
    try {
      canonical = fs.realpathSync.native(path.resolve(dir));
    } catch {
      throw new Error(`Workspace path does not exist: ${path.resolve(dir)}`);
    }
    if (!fs.statSync(canonical).isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${canonical}`);
    }
    this.workingDirOverrides.set(key, canonical);
  }

  /** Get the current working directory override for a session. */
  getSessionWorkingDir(key: string): string | undefined {
    return this.workingDirOverrides.get(key);
  }

  /** Enable or disable an MCP server for a session. Takes effect when the session is (re)created. */
  setSessionMcpEnabled(key: string, serverName: string, enabled: boolean): void {
    const overrides = this.mcpToolOverrides.get(key) ?? {};
    overrides[serverName] = enabled ? ["*"] : [];
    this.mcpToolOverrides.set(key, overrides);
  }

  /**
   * Returns MCP server status for a session, merging base config with per-session overrides.
   * Skipped servers (unresolvable inputs) remain skipped regardless of overrides.
   */
  getMcpStatus(key: string): { name: string; source: string; enabled: boolean; skipped: boolean }[] {
    const workingDir = this.workingDirOverrides.get(key);
    const overrides = this.mcpToolOverrides.get(key) ?? {};
    const statusList = McpConfigLoader.status(workingDir);
    return statusList.map((s) => {
      const skipped = !s.enabled; // unresolvable ${input:...} values
      if (skipped) {
        // Overrides cannot fix unresolvable inputs — always show as skipped
        return { ...s, enabled: false, skipped: true };
      }
      if (s.name in overrides) {
        return { ...s, enabled: overrides[s.name].length > 0, skipped: false };
      }
      return { ...s, skipped: false };
    });
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
