import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "../src/copilot.js";

type AssistantResult = { data: { content: string } };

type SessionLike = {
  sessionId: string;
  sendAndWait?: (options: unknown, timeout?: number) => Promise<AssistantResult>;
  getMessages?: () => Promise<unknown[]>;
  rpc?: {
    model: {
      getCurrent: () => Promise<{ modelId?: string }>;
    };
  };
  disconnect: () => Promise<void>;
};

type StoreLike = {
  get: (key: string) => string | undefined;
  set: (key: string, sessionId: string) => void;
  delete: (key: string) => void;
};

type ClientLike = {
  createSession: (config?: unknown) => Promise<SessionLike>;
  resumeSession: (sessionId: string, config?: unknown) => Promise<SessionLike>;
  start: () => Promise<void>;
  stop: () => Promise<Error[]>;
};

type TestableSessionManager = {
  sendMessage: SessionManager["sendMessage"];
  getHistory: SessionManager["getHistory"];
  getCurrentModel: SessionManager["getCurrentModel"];
  sessions: Map<string, SessionLike>;
  store: StoreLike;
  client: ClientLike;
};

function createTestManager(storedSessions: Record<string, string> = {}): TestableSessionManager {
  const manager = new SessionManager() as unknown as TestableSessionManager;
  manager.store = {
    get: (key) => storedSessions[key],
    set: (key, sessionId) => {
      storedSessions[key] = sessionId;
    },
    delete: (key) => {
      delete storedSessions[key];
    },
  };
  return manager;
}

test("sendMessage resumes and retries once when cached session is missing from Copilot", async () => {
  const storedSessions: Record<string, string> = { "user-1": "stale-session" };
  const manager = createTestManager(storedSessions);
  let staleSendCalls = 0;
  let freshSendCalls = 0;
  let staleDisconnected = false;
  let resumeCalls = 0;
  let createCalls = 0;

  const staleSession: SessionLike = {
    sessionId: "stale-session",
    sendAndWait: async () => {
      staleSendCalls += 1;
      throw new Error("Request session.send failed with message: Session not found: stale-session");
    },
    disconnect: async () => {
      staleDisconnected = true;
    },
  };

  const freshSession: SessionLike = {
    sessionId: "fresh-session",
    sendAndWait: async (options) => {
      freshSendCalls += 1;
      assert.deepEqual(options, { prompt: "hello" });
      return { data: { content: "retry ok" } };
    },
    disconnect: async () => {},
  };

  manager.sessions.set("user-1", staleSession);
  manager.client = {
    createSession: async () => {
      createCalls += 1;
      return freshSession;
    },
    resumeSession: async (sessionId) => {
      resumeCalls += 1;
      assert.equal(sessionId, "stale-session");
      return freshSession;
    },
    start: async () => {},
    stop: async () => [],
  };

  const response = await manager.sendMessage("user-1", "hello");

  assert.equal(response, "retry ok");
  assert.equal(staleSendCalls, 1);
  assert.equal(freshSendCalls, 1);
  assert.equal(staleDisconnected, true);
  assert.equal(resumeCalls, 1);
  assert.equal(createCalls, 0);
  assert.equal(storedSessions["user-1"], "fresh-session");
  assert.equal(manager.sessions.get("user-1"), freshSession);
});

test("sendMessage does not evict or retry non-stale-session errors", async () => {
  const storedSessions: Record<string, string> = { "user-1": "cached-session" };
  const manager = createTestManager(storedSessions);
  let disconnectCalls = 0;
  let resumeCalls = 0;

  const cachedSession: SessionLike = {
    sessionId: "cached-session",
    sendAndWait: async () => {
      throw new Error("rate limited");
    },
    disconnect: async () => {
      disconnectCalls += 1;
    },
  };

  manager.sessions.set("user-1", cachedSession);
  manager.client = {
    createSession: async () => {
      throw new Error("should not create");
    },
    resumeSession: async () => {
      resumeCalls += 1;
      throw new Error("should not resume");
    },
    start: async () => {},
    stop: async () => [],
  };

  await assert.rejects(() => manager.sendMessage("user-1", "hello"), /rate limited/);

  assert.equal(disconnectCalls, 0);
  assert.equal(resumeCalls, 0);
  assert.equal(storedSessions["user-1"], "cached-session");
  assert.equal(manager.sessions.get("user-1"), cachedSession);
});

test("getHistory returns null without resuming a stored session", async () => {
  const storedSessions: Record<string, string> = { "user-1": "stored-session" };
  const manager = createTestManager(storedSessions);
  let createCalls = 0;
  let resumeCalls = 0;

  manager.client = {
    createSession: async () => {
      createCalls += 1;
      throw new Error("should not create");
    },
    resumeSession: async () => {
      resumeCalls += 1;
      throw new Error("should not resume");
    },
    start: async () => {},
    stop: async () => [],
  };

  const history = await manager.getHistory("user-1");

  assert.equal(history, null);
  assert.equal(createCalls, 0);
  assert.equal(resumeCalls, 0);
  assert.equal(storedSessions["user-1"], "stored-session");
});

test("getCurrentModel retries once when cached session is missing from Copilot", async () => {
  const storedSessions: Record<string, string> = { "user-1": "stale-session" };
  const manager = createTestManager(storedSessions);
  let staleModelCalls = 0;
  let freshModelCalls = 0;
  let staleDisconnected = false;
  let resumeCalls = 0;

  const staleSession: SessionLike = {
    sessionId: "stale-session",
    rpc: {
      model: {
        getCurrent: async () => {
          staleModelCalls += 1;
          throw new Error("Request model.getCurrent failed with message: Session not found: stale-session");
        },
      },
    },
    disconnect: async () => {
      staleDisconnected = true;
    },
  };

  const freshSession: SessionLike = {
    sessionId: "fresh-session",
    rpc: {
      model: {
        getCurrent: async () => {
          freshModelCalls += 1;
          return { modelId: "claude-haiku-4.5" };
        },
      },
    },
    disconnect: async () => {},
  };

  manager.sessions.set("user-1", staleSession);
  manager.client = {
    createSession: async () => {
      throw new Error("should not create");
    },
    resumeSession: async (sessionId) => {
      resumeCalls += 1;
      assert.equal(sessionId, "stale-session");
      return freshSession;
    },
    start: async () => {},
    stop: async () => [],
  };

  const model = await manager.getCurrentModel("user-1");

  assert.equal(model, "claude-haiku-4.5");
  assert.equal(staleModelCalls, 1);
  assert.equal(freshModelCalls, 1);
  assert.equal(staleDisconnected, true);
  assert.equal(resumeCalls, 1);
  assert.equal(storedSessions["user-1"], "fresh-session");
  assert.equal(manager.sessions.get("user-1"), freshSession);
});