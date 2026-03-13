# GitHub Copilot SDK — Comprehensive Research Report

> **Repository**: [github/copilot-sdk](https://github.com/github/copilot-sdk)  
> **Status**: Technical Preview  
> **Protocol Version**: 3  
> **Last verified**: 2026-03-13 (commit `b67e3e5`)

---

## Executive Summary

The GitHub Copilot SDK is a **multi-language, production-ready programmable interface** to the same agentic engine that powers the Copilot CLI. Released under Technical Preview, it exposes four official SDKs (Node.js/TypeScript, Python, Go, and .NET) and several unofficial community SDKs. All SDKs communicate with an externally-installed Copilot CLI binary using a **JSON-RPC over stdio/TCP** transport, with the SDK managing the process lifecycle automatically. Applications embed Copilot's planning, tool invocation, and file-editing capabilities without writing their own agent orchestration.

Key distinguishing properties:
- **No orchestration required**: Copilot handles planning and multi-step reasoning; you supply custom tools and domain knowledge.
- **Bring Your Own Key (BYOK)**: Skip GitHub authentication entirely by providing API keys for OpenAI, Azure AI Foundry, or Anthropic.
- **Session persistence**: Resumable sessions survive process restarts, container migrations, and client reconnects.
- **Protocol versioning**: Current protocol version is `3`[^1], with backward compatibility down to v2[^2].

---

## Architecture Overview

```
┌─────────────────────────────────┐
│      Your Application           │
│  (Node.js / Python / Go / .NET) │
└───────────────┬─────────────────┘
                │  SDK API (CopilotClient / CopilotSession)
                ▼
┌─────────────────────────────────┐
│         SDK Client Layer        │
│  client.ts / client.py /        │
│  client.go / Client.cs          │
└───────────────┬─────────────────┘
                │  JSON-RPC (stdio or TCP)
                ▼
┌─────────────────────────────────┐
│    Copilot CLI (server mode)    │
│   Manages: planning, tools,     │
│   LLM calls, file edits, Git    │
└───────────────┬─────────────────┘
                │  HTTPS
                ▼
┌─────────────────────────────────┐
│   GitHub Copilot API / LLM      │
│   (or BYOK: Azure / OpenAI /    │
│         Anthropic)              │
└─────────────────────────────────┘
```

The SDK manages the Copilot CLI **child process lifecycle** automatically — discovering the binary, spawning it, attaching JSON-RPC, and tearing it down. Alternatively, you can connect to an external CLI server running in `--server` mode[^3].

---

## Key Repositories Summary

| Repository | Purpose | Language | Package |
|------------|---------|----------|---------|
| [github/copilot-sdk](https://github.com/github/copilot-sdk) | Monorepo for all official SDKs | TS/Python/Go/C# | Multiple |
| [github/copilot-sdk](https://github.com/github/copilot-sdk) `nodejs/` | TypeScript/Node.js SDK | TypeScript | `@github/copilot-sdk` on npm |
| [github/copilot-sdk](https://github.com/github/copilot-sdk) `python/` | Python SDK | Python | `github-copilot-sdk` on PyPI |
| [github/copilot-sdk](https://github.com/github/copilot-sdk) `go/` | Go SDK | Go | `github.com/github/copilot-sdk/go` |
| [github/copilot-sdk](https://github.com/github/copilot-sdk) `dotnet/` | .NET SDK | C# | `GitHub.Copilot.SDK` on NuGet |
| [copilot-community-sdk/copilot-sdk-java](https://github.com/copilot-community-sdk/copilot-sdk-java) | Community Java SDK | Java | Unofficial |
| [copilot-community-sdk/copilot-sdk-rust](https://github.com/copilot-community-sdk/copilot-sdk-rust) | Community Rust SDK | Rust | Unofficial |
| [github/awesome-copilot](https://github.com/github/awesome-copilot) | Cookbooks and instructions | Markdown | N/A |

---

## Node.js / TypeScript SDK

### Installation & Requirements

```bash
npm install @github/copilot-sdk
```

- **Node.js**: ≥ 20.0.0[^4]
- **Package name**: `@github/copilot-sdk`
- **Version**: `0.1.8` (npm)[^4]
- **Runtime dep**: `vscode-jsonrpc ^8.2.1`, `zod ^4.3.6`, `@github/copilot ^1.0.4`[^4]

### Core Exports[^5]

```typescript
// nodejs/src/index.ts
export { CopilotClient } from "./client.js";
export { CopilotSession, type AssistantMessageEvent } from "./session.js";
export { defineTool, approveAll } from "./types.js";
export type {
  CopilotClientOptions, SessionConfig, SessionEvent,
  Tool, ToolHandler, PermissionRequest, PermissionRequestResult,
  MCPLocalServerConfig, MCPRemoteServerConfig, CustomAgentConfig,
  ModelInfo, SessionMetadata, InfiniteSessionConfig, /* ... */
}
```

### Source Structure[^6]

```
nodejs/src/
├── client.ts          # CopilotClient — process lifecycle, auth, session management
├── session.ts         # CopilotSession — send prompts, stream events, disconnect
├── types.ts           # All TypeScript types + defineTool() / approveAll()
├── index.ts           # Public API re-exports
├── sdkProtocolVersion.ts  # Protocol version constant
├── extension.ts       # VS Code extension integration helpers
└── generated/         # Auto-generated RPC types from CLI schema
```

### Minimal Usage

```typescript
import { CopilotClient, defineTool, approveAll } from "@github/copilot-sdk";

const client = new CopilotClient();

const session = await client.createSession({
  model: "gpt-5",
  tools: [
    defineTool("get_weather", {
      description: "Get the current weather for a city",
      parameters: { city: { type: "string", description: "City name" } },
      handler: async ({ city }) => `Weather in ${city}: 72°F and sunny`,
    }),
  ],
  onPermissionRequest: approveAll,
});

// Streaming
session.on("message.delta", (e) => process.stdout.write(e.content ?? ""));

const result = await session.sendAndWait({ prompt: "What's the weather in Seattle?" });
console.log(result?.data?.content);

await session.disconnect();
await client.stop();
```

---

## Python SDK

### Installation & Requirements

```bash
pip install github-copilot-sdk
```

- **Python**: ≥ 3.11[^7]
- **Package name**: `github-copilot-sdk`
- **Runtime deps**: `pydantic>=2.0`, `python-dateutil>=2.9.0.post0`[^7]

### Source Structure[^8]

```
python/copilot/
├── __init__.py        # Public exports
├── client.py          # CopilotClient (~64KB — process management, session creation)
├── session.py         # CopilotSession (~29KB — send/stream/disconnect)
├── types.py           # Pydantic types (~37KB)
├── tools.py           # define_tool() helper (~7KB)
├── jsonrpc.py         # JSON-RPC transport (~14KB)
├── sdk_protocol_version.py  # Protocol version
└── generated/         # Auto-generated from CLI schema
```

### Minimal Usage

```python
import asyncio
from copilot import CopilotClient, define_tool, PermissionRequestResult

async def main():
    client = CopilotClient()
    await client.start()

    session = await client.create_session({
        "model": "gpt-5",
        "tools": [
            define_tool(
                name="get_weather",
                description="Get the current weather for a city",
                handler=lambda city: f"Weather in {city}: 72°F",
                parameters={"city": {"type": "string"}},
            )
        ],
        "on_permission_request": lambda req, inv: PermissionRequestResult(kind="approved"),
    })

    result = await session.send_and_wait({"prompt": "What's the weather in Seattle?"})
    print(result.data.content)

    await client.stop()

asyncio.run(main())
```

---

## Go SDK

### Installation & Requirements

```bash
go get github.com/github/copilot-sdk/go
```

- **Go**: ≥ 1.24[^9]
- **Module**: `github.com/github/copilot-sdk/go`
- **Deps**: `github.com/google/jsonschema-go v0.4.2`, `github.com/klauspost/compress v1.18.3`, `github.com/google/uuid v1.6.0`[^9]

### Source Structure[^10]

```
go/
├── client.go                 # Client struct, Start/Stop, session management (~47KB)
├── session.go                # Session struct, SendAndWait, event streaming (~23KB)
├── types.go                  # All Go types (~37KB)
├── definetool.go             # Tool definition helpers (~4KB)
├── generated_session_events.go  # Auto-generated event types (~61KB)
├── permissions.go            # Permission constants and helpers
├── sdk_protocol_version.go   # Protocol version constant
├── process_other.go          # Unix process group management
├── process_windows.go        # Windows process management
├── rpc/                      # JSON-RPC transport layer
├── embeddedcli/              # Embedded CLI binary packaging
├── internal/                 # Internal helpers
├── cmd/                      # CLI tools
└── samples/                  # Usage examples
```

### Minimal Usage

```go
package main

import (
    "context"
    "fmt"
    "log"
    copilot "github.com/github/copilot-sdk/go"
)

func main() {
    ctx := context.Background()
    client := copilot.NewClient(nil)

    if err := client.Start(ctx); err != nil {
        log.Fatal(err)
    }
    defer client.Stop()

    weatherTool, _ := copilot.DefineTool("get_weather",
        func(params struct{ City string }) (string, error) {
            return fmt.Sprintf("Weather in %s: 72°F", params.City), nil
        },
    )

    session, err := client.CreateSession(ctx, &copilot.SessionConfig{
        Model: "gpt-5",
        Tools: []copilot.Tool{weatherTool},
        OnPermissionRequest: func(req copilot.PermissionRequest, inv copilot.PermissionInvocation) (copilot.PermissionRequestResult, error) {
            return copilot.PermissionRequestResult{Kind: copilot.PermissionKindApproved}, nil
        },
    })
    if err != nil {
        log.Fatal(err)
    }
    defer session.Disconnect()

    result, _ := session.SendAndWait(ctx, copilot.MessageOptions{
        Prompt: "What's the weather in Seattle?",
    })
    fmt.Println(result.Data.Content)
}
```

### Notable Go Features

- **Strongly-typed `PermissionRequestResultKind`** constants (`PermissionKindApproved`, `PermissionKindDeniedByRules`, etc.)[^11]
- **Platform-specific process management**: `process_other.go` for Unix, `process_windows.go` for Windows[^10]
- **`get_last_session_id()` / `GetLastSessionID()`** for cross-SDK parity (added v0.1.31)[^11]

---

## .NET SDK

### Installation & Requirements

```bash
dotnet add package GitHub.Copilot.SDK
```

- **.NET SDK tool version**: as specified in `global.json`[^12]
- **Solution**: `GitHub.Copilot.SDK.slnx`[^12]
- **NuGet ID**: `GitHub.Copilot.SDK`

### Source Structure[^13]

```
dotnet/src/
├── Client.cs          # CopilotClient — process lifecycle, sessions (~66KB)
├── Session.cs         # CopilotSession — SendAndWaitAsync, events (~32KB)
├── Types.cs           # All C# types (~68KB)
├── PermissionHandlers.cs  # PermissionHandlers.ApproveAll helper
├── SdkProtocolVersion.cs  # Protocol version constant
├── ActionDisposable.cs    # IDisposable helper
├── GitHub.Copilot.SDK.csproj  # Project file with NuGet config
├── Generated/         # Auto-generated RPC types
└── build/             # MSBuild props for embedding CLI
```

### Minimal Usage

```csharp
using GitHub.Copilot.SDK;

await using var client = new CopilotClient();

await using var session = await client.CreateSessionAsync(new SessionConfig
{
    Model = "gpt-5",
    Tools = [
        AIFunctionFactory.Create(
            ([Description("City name")] string city) => $"Weather in {city}: 72°F",
            "get_weather",
            "Get the current weather for a city"
        )
    ],
    OnPermissionRequest = PermissionHandlers.ApproveAll,
});

session.OnMessageDelta += (e) => Console.Write(e.Content ?? "");

var result = await session.SendAndWaitAsync(new MessageOptions
{
    Prompt = "What's the weather in Seattle?"
});

Console.WriteLine(result?.Data?.Content);
```

### Notable .NET Features

- **`IAsyncDisposable`** on both `CopilotClient` and `CopilotSession` — use `await using`[^13]
- **Event-based API**: `session.OnPermissionCompleted += ...`, `session.OnMessageDelta += ...`
- **Strongly-typed `PermissionRequestResultKind`** enum (added v0.1.31)[^11]
- **`AIFunctionFactory.Create()`** from `Microsoft.Extensions.AI` for tool definition[^13]
- Uses `WaitAsync(TimeSpan)` for async timeout (not `Task.WhenAny` + `Task.Delay`)[^14]

---

## JSON-RPC Protocol

All four SDKs communicate with the Copilot CLI server over **JSON-RPC 2.0**[^3]:

```
Your Application
       ↓
  SDK Client  (manages child process)
       ↓  JSON-RPC 2.0 over stdio
  Copilot CLI (--server mode)
       ↓  HTTPS
  GitHub Copilot API
```

### Protocol Version

Current protocol version is **3** (stored in `sdk-protocol-version.json`)[^1].

- **v3 (current)**: Broadcasts `external_tool.requested` and `permission.requested` as session events to all connected clients. Enables multi-client architectures[^11].
- **v2 backward compat** (added v0.1.32): SDK auto-detects server protocol version and adapts v2 messages into the v3 handler API — no code changes needed[^2].

### Transport Options

| Mode | How |
|------|-----|
| **Managed (default)** | SDK spawns CLI as subprocess, connects via stdio |
| **External server** | Connect to CLI running in `--server` mode via TCP/URL (`cliUrl` option) |
| **Embedded CLI** | CLI binary embedded in Go `embeddedcli/` package for self-contained deployments |

---

## Authentication

Four methods are supported, in this priority order[^15]:

| Priority | Method | Notes |
|----------|--------|-------|
| 1 | Explicit `githubToken` option | Passed directly to constructor |
| 2 | HMAC key | `CAPI_HMAC_KEY` or `COPILOT_HMAC_KEY` env var |
| 3 | Direct API token | `GITHUB_COPILOT_API_TOKEN` + `COPILOT_API_URL` |
| 4 | Env var tokens | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| 5 | Stored OAuth credentials | From previous `copilot` CLI login |
| 6 | GitHub CLI credentials | From `gh auth` |

### Supported Token Types[^15]

- `gho_` — OAuth user access tokens ✅
- `ghu_` — GitHub App user access tokens ✅
- `github_pat_` — Fine-grained personal access tokens ✅
- `ghp_` — Classic PATs ❌ (deprecated, not supported)

### BYOK (Bring Your Own Key)[^16]

Bypass GitHub authentication entirely using your own LLM provider API keys:

```typescript
const client = new CopilotClient({
  provider: {
    type: "azure",
    endpoint: "https://my-resource.openai.azure.com",
    apiKey: process.env.AZURE_OPENAI_KEY,
    deploymentId: "gpt-5-deployment",
  },
});
```

**Supported BYOK providers**: Azure AI Foundry, OpenAI, Anthropic, OpenAI-compatible endpoints.

> ⚠️ Microsoft Entra ID, managed identities, and third-party IdPs are NOT supported for BYOK. Only key-based auth.[^16]

---

## Core Features

### 1. Custom Tools

All SDKs provide a `defineTool` / `define_tool` / `DefineTool` helper that registers JSON-Schema-typed functions callable by the Copilot agent[^5][^8][^17]:

```typescript
// TypeScript
const tool = defineTool("search_db", {
  description: "Search the product database",
  parameters: {
    query: { type: "string", description: "Search query" },
    limit: { type: "number", description: "Max results" },
  },
  handler: async ({ query, limit }) => {
    return JSON.stringify(await db.search(query, limit));
  },
});
```

**Override built-in tools** (added v0.1.30): Register a custom tool with the same name as a built-in (e.g., `grep`, `edit_file`) by setting `overridesBuiltInTool: true`[^18].

### 2. MCP Servers (Model Context Protocol)

Connect local (stdio) or remote (HTTP/SSE) MCP servers to extend the agent's toolset[^19]:

```typescript
const session = await client.createSession({
  mcpServers: {
    "filesystem": {
      type: "local",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      tools: ["*"],  // "*" = all tools, [] = none
    },
    "github": {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: `Bearer ${token}` },
      tools: ["*"],
    },
  },
});
```

### 3. Custom Agents

Define specialized sub-agents with scoped system prompts and tool restrictions. The Copilot runtime auto-selects agents based on the user's request[^20]:

```typescript
const session = await client.createSession({
  customAgents: [{
    name: "security-auditor",
    description: "Security-focused code reviewer",
    prompt: "You specialize in OWASP Top 10 vulnerabilities",
    tools: ["read_file", "grep"],  // restrict tool access
  }],
});
```

### 4. Skills

Load reusable prompt modules from directories containing `SKILL.md` files[^21]:

```
skills/
├── code-review/
│   └── SKILL.md      # Instructions injected into session context
└── documentation/
    └── SKILL.md
```

```typescript
const session = await client.createSession({
  skillDirectories: ["./skills"],
  disabledSkills: ["deprecated-skill"],
});
```

### 5. Session Persistence & Resume

Sessions are persisted to `~/.copilot/session-state/{sessionId}/`[^22]:

```
~/.copilot/session-state/user-123-task-456/
├── checkpoints/     # Conversation history snapshots
├── plan.md          # Agent planning state
└── files/           # Session artifacts
```

```typescript
// Create resumable session (provide your own ID)
const session = await client.createSession({ sessionId: "user-123-task-456" });

// Later, even in a different process:
const resumed = await client.resumeSession("user-123-task-456");
```

**What is/isn't persisted**[^22]:

| Data | Persisted? |
|------|-----------|
| Conversation history | ✅ Yes |
| Tool call results | ✅ Yes |
| Agent planning state | ✅ Yes |
| Session artifacts | ✅ Yes |
| Provider/API keys | ❌ No (security) |
| In-memory tool state | ❌ No |

### 6. Hooks

Plug custom logic into every stage of a session lifecycle (session start, prompt received, tool call, response, session end)[^23]:

```typescript
const session = await client.createSession({
  hooks: {
    onToolCall: async (invocation) => {
      await auditLog.record(invocation);
      return invocation;  // or modify/block it
    },
    onSessionEnd: async (summary) => {
      await notifyUser(summary);
    },
  },
});
```

### 7. Model Switching

Change the LLM model mid-session (added v0.1.30)[^18]:

```typescript
await session.setModel("claude-sonnet-4");  // TypeScript
await session.set_model("gpt-4.1")          # Python
await session.SetModel(ctx, "gpt-4.1")      // Go
await session.SetModelAsync("gpt-4.1");     // C#
```

### 8. Multi-Client Sessions (Protocol v3)

Multiple clients can connect to the same session, each contributing different tools. Permission approvals are broadcast to all[^11]:

```typescript
const session1 = await client1.createSession({
  tools: [defineTool("search", { handler: doSearch })],
});
const session2 = await client2.resumeSession(session1.id, {
  tools: [defineTool("analyze", { handler: doAnalyze })],
});
```

### 9. Infinite Sessions

For workflows that may exceed context limits, enable automatic compaction[^22]:

```typescript
const session = await client.createSession({
  infiniteSessions: {
    enabled: true,
    backgroundCompactionThreshold: 0.80,  // compact at 80% context
    bufferExhaustionThreshold: 0.95,       // block at 95%
  },
});
```

### 10. Image Input

The SDK supports multimodal prompts — attach images alongside text[^24].

---

## Billing

- **With GitHub Copilot subscription**: Each prompt counts against your premium request quota[^3].
- **With BYOK**: Billed directly by your LLM provider; no GitHub quota consumed[^3].
- **Free tier**: GitHub Copilot has a free tier with limited usage[^3].

---

## Deployment Patterns

### Pattern 1: One CLI Per User (Recommended)

```
User A → SDK Client A → CLI Process A → ~/session-state/user-a/
User B → SDK Client B → CLI Process B → ~/session-state/user-b/
```

Best for multi-tenant environments. Complete process and storage isolation[^22].

### Pattern 2: Shared CLI

```
User A ──┐
User B ──┤→ SDK Client → Single CLI → Session A / Session B / Session C
User C ──┘
```

Resource-efficient but requires application-level access control (validate session ID ownership before operations)[^22].

### Azure Dynamic Sessions / Containers

Mount `~/.copilot/session-state/` to persistent storage (Azure File Share, EFS, etc.) so sessions survive container restarts[^22].

---

## SDK Versioning & Release History

All four SDKs share the same version number. Selected changelog:

| Version | Date | Highlights |
|---------|------|------------|
| v0.1.32 | 2026-03-07 | Backward compat with v2 CLI servers |
| v0.1.31 | 2026-03-07 | Protocol v3 multi-client broadcasts; typed `PermissionRequestResultKind` for .NET and Go |
| v0.1.30 | 2026-03-03 | Override built-in tools; `session.setModel()` convenience API |

The changelog is AI-generated when stable releases are published[^25].

---

## Community & Unofficial SDKs

| Language | Repo | Status |
|----------|------|--------|
| Java | [copilot-community-sdk/copilot-sdk-java](https://github.com/copilot-community-sdk/copilot-sdk-java) | Community, unsupported |
| Rust | [copilot-community-sdk/copilot-sdk-rust](https://github.com/copilot-community-sdk/copilot-sdk-rust) | Community, unsupported |
| Clojure | [copilot-community-sdk/copilot-sdk-clojure](https://github.com/copilot-community-sdk/copilot-sdk-clojure) | Community, unsupported |
| C++ | [0xeb/copilot-sdk-cpp](https://github.com/0xeb/copilot-sdk-cpp) | Community, unsupported |

---

## Active Development Notes

- The repo uses **Copilot CLI itself** to merge PRs — many commits are authored by `copilot-swe-agent[bot]`[^14]
- **Auto-restart was removed** (v0.1.32 area, commit `5a4153`): the `autoRestart` option never worked correctly; it's now a deprecated no-op[^26]
- The `@github/copilot` npm dependency (v1.0.4) is the bundled CLI binary package updated by automated workflow[^27]
- Code generation scripts live in `scripts/codegen/` and generate the `generated/` directories in each SDK from the CLI's schema

---

## Confidence Assessment

| Claim | Confidence | Basis |
|-------|-----------|-------|
| Architecture (JSON-RPC over stdio) | **High** | Verified in `README.md`, `go/client.go`, `python/copilot/jsonrpc.py` |
| Protocol version = 3 | **High** | `sdk-protocol-version.json` read directly |
| SDK versions and package names | **High** | `package.json`, `pyproject.toml`, `go.mod` read directly |
| Feature set (tools, MCP, skills, hooks) | **High** | Feature docs and source exports verified |
| BYOK providers | **High** | `docs/auth/byok.md` content confirmed |
| Authentication priority order | **High** | `docs/auth/index.md` read directly |
| Session persistence path | **High** | `docs/features/session-persistence.md` verified |
| TypeScript source structure | **High** | `nodejs/src/` directory listing confirmed |
| Go source file sizes / structure | **High** | `go/` directory listing confirmed |
| .NET source structure | **High** | `dotnet/src/` directory listing confirmed |
| Billing model | **Medium** | From README FAQ — not independently verified in billing code |
| Specific internal JSON-RPC message shapes | **Medium** | Not deeply inspected; inferred from generated files and docs |

---

## Footnotes

[^1]: `sdk-protocol-version.json` — `{"version": 3}` — commit `b67e3e5`
[^2]: `CHANGELOG.md` — v0.1.32 "backward compatibility with v2 CLI servers" — PR #706
[^3]: `README.md` — Architecture section and FAQ — `github/copilot-sdk`
[^4]: `nodejs/package.json` — version `0.1.8`, engines `node>=20.0.0`
[^5]: `nodejs/src/index.ts` — Public exports listing
[^6]: `nodejs/src/` directory listing
[^7]: `python/pyproject.toml` — `requires-python = ">=3.11"`, deps section
[^8]: `python/copilot/` directory listing with file sizes
[^9]: `go/go.mod` — `go 1.24`, dependency listing
[^10]: `go/` directory listing with file sizes
[^11]: `CHANGELOG.md` — v0.1.31 entries for typed PermissionRequestResultKind, GetLastSessionID, multi-client broadcasts — PR #686, #631, #671
[^12]: `dotnet/global.json` and `dotnet/GitHub.Copilot.SDK.slnx`
[^13]: `dotnet/src/` directory listing with file sizes
[^14]: Commit `b67e3e5` — "Replace Task.WhenAny+Task.Delay with .WaitAsync(TimeSpan)" — PR #805
[^15]: `docs/auth/index.md` — Authentication Priority section
[^16]: `docs/auth/index.md` — BYOK section noting no Entra ID support
[^17]: `nodejs/src/types.ts` — `defineTool` function definition (~29KB)
[^18]: `CHANGELOG.md` — v0.1.30 "support overriding built-in tools" and `session.setModel()` — PR #636, #621
[^19]: `docs/features/mcp.md` — MCP server configuration and examples
[^20]: `docs/features/custom-agents.md` — Custom agents overview
[^21]: `docs/features/skills.md` — Skills documentation
[^22]: `docs/features/session-persistence.md` — Session state storage and resume patterns
[^23]: `docs/features/hooks.md` — Hooks documentation
[^24]: `docs/features/image-input.md` — Image input feature
[^25]: `CHANGELOG.md` — "automatically generated by an AI agent when stable releases are published"
[^26]: Commit `5a4153` — "Remove autoRestart feature across all SDKs" with detailed message
[^27]: Commit `0dd6bfb` — "Update @github/copilot to 1.0.4" via github-actions[bot]
