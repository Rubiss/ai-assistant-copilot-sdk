import fs from "fs";
import os from "os";
import path from "path";
import { CopilotClient, approveAll } from "@github/copilot-sdk";
const DISCORD_MAX = 1990; // Leave headroom for code-fence close/reopen overhead
/**
 * Splits text into chunks that each fit within Discord's 2000-char message limit.
 * Splits at paragraph → newline → word boundaries to avoid mid-word cuts.
 * Tracks open code fences: closes the fence at the split point and reopens it
 * (with the same language tag) at the start of the next chunk.
 */
export function chunkForDiscord(text, maxLen = DISCORD_MAX) {
    if (text.length <= maxLen)
        return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
        // Prefer clean boundaries in the back half of the window
        const half = Math.floor(maxLen / 2);
        let splitAt = maxLen;
        const paraBreak = remaining.lastIndexOf("\n\n", maxLen);
        if (paraBreak >= half) {
            splitAt = paraBreak + 2;
        }
        else {
            const lineBreak = remaining.lastIndexOf("\n", maxLen);
            if (lineBreak >= half) {
                splitAt = lineBreak + 1;
            }
            else {
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
        let openFenceLang = null;
        for (const line of chunk.split("\n")) {
            const m = line.match(/^```(\S*)\s*$/);
            if (!m)
                continue;
            const lang = m[1];
            if (openFenceLang === null) {
                openFenceLang = lang; // entering a fence (lang may be empty for unlabeled)
            }
            else if (lang === "") {
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
    if (remaining.length > 0)
        chunks.push(remaining);
    return chunks;
}
/**
 * Number of chunks beyond which the full response is also attached as a
 * Markdown file so the reader doesn't have to piece together many messages.
 */
const FILE_ATTACHMENT_THRESHOLD = 3;
/**
 * Prepares a Copilot response for sending to Discord.
 * Short responses are returned as text chunks only.
 * Longer responses also include the full text as a `.md` file buffer so the
 * caller can attach it alongside the first text chunk.
 */
export function prepareDiscordResponse(text) {
    const chunks = chunkForDiscord(text);
    if (chunks.length <= FILE_ATTACHMENT_THRESHOLD) {
        return { chunks };
    }
    return {
        chunks: [chunks[0]],
        file: {
            buffer: Buffer.from(text, "utf-8"),
            name: "response.md",
        },
    };
}
/**
 * Persists the mapping of Discord session keys (user ID or thread ID) to
 * Copilot session IDs so sessions can be resumed after a bot restart.
 *
 * The Copilot CLI already keeps session data on disk; we only need to store
 * the ID lookup. Uses synchronous I/O since the file is tiny (<1 KB).
 */
class SessionStore {
    filePath;
    data = {};
    constructor() {
        this.filePath = path.join(os.homedir(), ".config", "ai-assistant", "sessions.json");
        this.load();
    }
    load() {
        try {
            const raw = fs.readFileSync(this.filePath, "utf8");
            this.data = JSON.parse(raw);
        }
        catch {
            // File missing or malformed — start fresh
            this.data = {};
        }
    }
    get(key) {
        return this.data[key];
    }
    set(key, sessionId) {
        if (this.data[key] === sessionId)
            return; // skip disk write if unchanged (e.g., normal resume)
        this.data[key] = sessionId;
        this.persist();
    }
    delete(key) {
        delete this.data[key];
        this.persist();
    }
    persist() {
        try {
            const dir = path.dirname(this.filePath);
            fs.mkdirSync(dir, { recursive: true });
            const tmp = this.filePath + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
            fs.renameSync(tmp, this.filePath); // atomic replace — no partial-write corruption
        }
        catch (err) {
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
    static GLOBAL_PATH = process.env.MCP_CONFIG_PATH ??
        path.join(os.homedir(), ".config", "Code", "User", "mcp.json");
    static load(workingDir) {
        const global = this.readFile(this.GLOBAL_PATH, "mcpServers");
        const workspace = workingDir
            ? this.readFile(path.join(workingDir, ".vscode", "mcp.json"), "servers")
            : {};
        const merged = { ...global, ...workspace };
        return this.resolveAndFilter(merged);
    }
    static readFile(filePath, key) {
        try {
            const raw = fs.readFileSync(filePath, "utf8");
            const parsed = JSON.parse(raw);
            const servers = parsed[key];
            if (servers && typeof servers === "object" && !Array.isArray(servers)) {
                return servers;
            }
        }
        catch {
            // Missing or malformed — silently skip
        }
        return {};
    }
    static resolveAndFilter(raw) {
        const result = {};
        for (const [name, cfg] of Object.entries(raw)) {
            try {
                const resolved = this.resolveInputs(JSON.stringify(cfg));
                if (resolved === null) {
                    console.warn(`[McpConfigLoader] Skipping "${name}": unresolved \${input:...} values`);
                    continue;
                }
                const server = JSON.parse(resolved);
                if (!Array.isArray(server["tools"]))
                    server["tools"] = ["*"];
                result[name] = server;
            }
            catch {
                console.warn(`[McpConfigLoader] Skipping "${name}": invalid config`);
            }
        }
        return result;
    }
    /** Returns null if any ${input:xxx} remain after env resolution. */
    static resolveInputs(json) {
        const resolved = json.replace(/\$\{input:([\w-]+)\}/g, (match, id) => {
            const envKey = "MCP_INPUT_" + id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
            return process.env[envKey] ?? match;
        });
        return /\$\{input:[\w-]+\}/.test(resolved) ? null : resolved;
    }
    /** Returns per-server status including whether it was skipped. */
    static status(workingDir) {
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
    client;
    // Stores settled sessions for established users
    sessions = new Map();
    // Stores in-flight creation promises to prevent duplicate session creation (TOCTOU fix)
    pending = new Map();
    // Serializes concurrent sendMessage calls per session to prevent state corruption
    messageQueues = new Map();
    // Persists Discord key → Copilot session ID across restarts
    store = new SessionStore();
    // Per-session working directory override (affects MCP loading and agent file ops)
    workingDirOverrides = new Map();
    // Per-session MCP tool overrides: server name → tools array (["*"] = enabled, [] = disabled)
    mcpToolOverrides = new Map();
    constructor() {
        this.client = new CopilotClient();
    }
    async getOrCreateSession(key) {
        // Return already-established in-memory session
        const existing = this.sessions.get(key);
        if (existing)
            return existing;
        // If creation/resumption is already in flight, wait for it (race condition fix)
        const inFlight = this.pending.get(key);
        if (inFlight)
            return inFlight;
        const userSkillsDir = path.join(os.homedir(), ".agents", "skills");
        const workingDir = this.workingDirOverrides.get(key);
        const mcpServers = this.buildMcpConfig(key);
        const sessionConfig = {
            onPermissionRequest: approveAll,
            skillDirectories: [userSkillsDir],
            ...(workingDir ? { workingDirectory: workingDir } : {}),
            ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
        };
        const storedSessionId = this.store.get(key);
        const creation = (storedSessionId
            ? // Try to resume the existing Copilot session from disk
                this.client
                    .resumeSession(storedSessionId, sessionConfig)
                    .catch((err) => {
                    console.warn(`[SessionManager] Resume failed for ${key} (${storedSessionId}), creating new session:`, err);
                    return this.client.createSession({ model: "claude-haiku-4.5", ...sessionConfig });
                })
            : this.client.createSession({ model: "claude-haiku-4.5", ...sessionConfig })).then((session) => {
            // Guard: if resetSession removed our pending entry while we were in flight,
            // don't resurrect the session — disconnect it and skip persisting.
            // The in-flight caller still gets the session for their one message, but
            // it won't be cached or written to disk for future calls.
            if (this.pending.get(key) !== creation) {
                session.disconnect().catch(() => { });
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
    async sendMessage(userId, prompt, imagePaths) {
        const tail = this.messageQueues.get(userId) ?? Promise.resolve();
        const next = tail.then(async () => {
            const session = await this.getOrCreateSession(userId);
            const attachments = imagePaths?.map((a) => ({
                type: "file",
                path: a.path,
                ...(a.displayName ? { displayName: a.displayName } : {}),
            }));
            const result = await session.sendAndWait({ prompt, ...(attachments?.length ? { attachments } : {}) }, parseInt(process.env.COPILOT_TIMEOUT_MS ?? "") || 10 * 60 * 1000 // default 10-minute timeout
            );
            return result?.data?.content ?? "(no response)";
        });
        // Non-rejecting tail so errors don't permanently block the queue
        this.messageQueues.set(userId, next.catch(() => { }));
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
    async getHistory(userId) {
        const session = this.sessions.get(userId);
        if (!session)
            return null;
        return session.getMessages();
    }
    async listModels() {
        await this.client.start(); // listModels() requires an active connection; start() is idempotent
        return this.client.listModels();
    }
    async setModel(userId, model) {
        const session = await this.getOrCreateSession(userId);
        await session.setModel(model);
    }
    async getCurrentModel(key) {
        const session = await this.getOrCreateSession(key);
        const result = await session.rpc.model.getCurrent();
        return result.modelId;
    }
    // ── Agent management ────────────────────────────────────────────────────────
    async listAgents(key) {
        const session = await this.getOrCreateSession(key);
        const result = await session.rpc.agent.list();
        return result.agents;
    }
    async getCurrentAgent(key) {
        const session = await this.getOrCreateSession(key);
        const result = await session.rpc.agent.getCurrent();
        return result.agent;
    }
    async selectAgent(key, name) {
        const session = await this.getOrCreateSession(key);
        const result = await session.rpc.agent.select({ name });
        return result.agent;
    }
    async deselectAgent(key) {
        const session = await this.getOrCreateSession(key);
        await session.rpc.agent.deselect();
    }
    // ── Session mode ─────────────────────────────────────────────────────────────
    async getMode(key) {
        const session = await this.getOrCreateSession(key);
        const result = await session.rpc.mode.get();
        return result.mode;
    }
    async setMode(key, mode) {
        const session = await this.getOrCreateSession(key);
        await session.rpc.mode.set({ mode });
    }
    // ── Compaction ───────────────────────────────────────────────────────────────
    async compact(key) {
        const session = await this.getOrCreateSession(key);
        return session.rpc.compaction.compact();
    }
    // ── Fleet ────────────────────────────────────────────────────────────────────
    async startFleet(key, prompt) {
        const session = await this.getOrCreateSession(key);
        const result = await session.rpc.fleet.start({ prompt });
        return result.started;
    }
    // ── Plan management ──────────────────────────────────────────────────────────
    async readPlan(key) {
        const session = await this.getOrCreateSession(key);
        return session.rpc.plan.read();
    }
    async updatePlan(key, content) {
        const session = await this.getOrCreateSession(key);
        await session.rpc.plan.update({ content });
    }
    async deletePlan(key) {
        const session = await this.getOrCreateSession(key);
        await session.rpc.plan.delete();
    }
    // ── Workspace management ─────────────────────────────────────────────────────
    async listWorkspaceFiles(key) {
        const session = await this.getOrCreateSession(key);
        const result = await session.rpc.workspace.listFiles();
        return result.files;
    }
    async readWorkspaceFile(key, filePath) {
        const session = await this.getOrCreateSession(key);
        const result = await session.rpc.workspace.readFile({ path: filePath });
        return result.content;
    }
    async createWorkspaceFile(key, filePath, content) {
        const session = await this.getOrCreateSession(key);
        await session.rpc.workspace.createFile({ path: filePath, content });
    }
    async resetSession(key) {
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
            await session.disconnect().catch((err) => console.error(`[SessionManager] Error disconnecting session for ${key}:`, err));
        }
        // Permanently delete from Copilot's disk store so it can't be resumed
        const sessionId = session?.sessionId ?? storedSessionId;
        if (sessionId) {
            await this.client.start();
            await this.client.deleteSession(sessionId).catch((err) => console.error(`[SessionManager] Error deleting session ${sessionId}:`, err));
        }
    }
    // --- MCP + Working Directory management ---
    /** Build the mcpServers config for session creation by merging base config with session overrides. */
    buildMcpConfig(key) {
        const workingDir = this.workingDirOverrides.get(key);
        const base = McpConfigLoader.load(workingDir);
        const overrides = this.mcpToolOverrides.get(key) ?? {};
        const result = {};
        for (const [name, cfg] of Object.entries(base)) {
            if (name in overrides) {
                result[name] = { ...cfg, tools: overrides[name] };
            }
            else {
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
    setSessionWorkingDir(key, dir) {
        if (!dir || dir.includes("\0")) {
            throw new Error("Invalid workspace path.");
        }
        let canonical;
        try {
            canonical = fs.realpathSync.native(path.resolve(dir));
        }
        catch {
            throw new Error(`Workspace path does not exist: ${path.resolve(dir)}`);
        }
        if (!fs.statSync(canonical).isDirectory()) {
            throw new Error(`Workspace path is not a directory: ${canonical}`);
        }
        this.workingDirOverrides.set(key, canonical);
    }
    /** Get the current working directory override for a session. */
    getSessionWorkingDir(key) {
        return this.workingDirOverrides.get(key);
    }
    /** Enable or disable an MCP server for a session. Takes effect when the session is (re)created. */
    setSessionMcpEnabled(key, serverName, enabled) {
        const overrides = this.mcpToolOverrides.get(key) ?? {};
        overrides[serverName] = enabled ? ["*"] : [];
        this.mcpToolOverrides.set(key, overrides);
    }
    /**
     * Returns MCP server status for a session, merging base config with per-session overrides.
     * Skipped servers (unresolvable inputs) remain skipped regardless of overrides.
     */
    getMcpStatus(key) {
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
    async shutdown() {
        const allSessions = Array.from(this.sessions.values());
        this.sessions.clear();
        this.pending.clear();
        // disconnect() preserves session data on disk for resume on next start
        await Promise.all(allSessions.map((s) => s.disconnect().catch((err) => console.error("[SessionManager] Shutdown error:", err))));
        await this.client.stop();
    }
}
