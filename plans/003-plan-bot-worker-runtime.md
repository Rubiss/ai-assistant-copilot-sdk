# Implementation Plan: Bot + Worker Runtime Split

## Problem

The ai-assistant is a single-process Discord bot. All future SRE automation (webhooks, Docker event watching, incident management, scheduled reports) would be tangled with the Discord gateway. This plan splits the runtime into two cooperating processes that share durable state via SQLite.

## Decisions (from clarification)

| Question | Decision |
|----------|----------|
| Scope | All 8 phases, granular tasks |
| Outbox delivery | Bot-only forever — worker never touches Discord API |
| Incident threads | One thread per incident |
| Report generation | Hybrid: `schedule_runs` for scheduling, outbox for delivery |
| Config model | Central `config.json`, per-plugin later if needed |
| SQLite library | `better-sqlite3` (sync API, raw SQL) |
| HTTP server | Fastify (routing, schema validation, hooks for HMAC) |
| Testing | Vitest from Phase 1 |

## Architecture Summary

```
Bot Process ──► Discord Gateway
     │
     ▼
  SQLite (ops.db)  ◄── shared durable state
     ▲
     │
Worker Process ──► HTTP webhooks, schedulers, Docker events
```

Both processes share: config, plugin registry, store, types, adapters.

---

## Phase 1: Runtime Foundation

**Goal**: Separate entrypoints, config loader, plugin registry, Vitest. Current bot keeps working.

### 1.1 — Restructure src/ directory skeleton

Create the new directory structure from the plan. Don't move existing files yet — just create the new directories and placeholder modules.

**New directories**:
- `src/app/config/`
- `src/app/plugins/`
- `src/app/store/`
- `src/app/policies/`
- `src/app/copilot/`
- `src/bot/`
- `src/worker/`
- `src/adapters/`
- `src/plugins/chat-core/`
- `src/plugins/sre-docker-host/`

**Files to create**:
- `src/app/config/env.ts` — loads `.env` and validates required vars
- `src/app/config/runtimeConfig.ts` — loads `~/.ai-assistant/config.json` with defaults
- `src/app/config/validate.ts` — schema validation for runtime config
- `src/app/plugins/types.ts` — `Plugin`, `PluginContribution`, `PluginCategory` types
- `src/app/plugins/registry.ts` — plugin registration, lookup, lifecycle

### 1.2 — Config loader

**`src/app/config/env.ts`**:
- Load dotenv from `~/.ai-assistant/.env` (respect `AI_ASSISTANT_CONFIG_DIR`)
- Export typed env accessor: `env(key)` with required/optional distinction
- Validate: `DISCORD_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID` are required for bot
- Worker-only env vars are optional when running bot-only

**`src/app/config/runtimeConfig.ts`**:
- Load from `~/.ai-assistant/config.json`
- Merge with defaults (chat-core enabled, sre-docker-host disabled)
- Export typed `RuntimeConfig` interface
- Create default config on first run if missing

**`src/app/config/validate.ts`**:
- Runtime config schema validation (no external deps — hand-rolled type guards)
- Clear error messages for invalid config

### 1.3 — Plugin registry types and core

**`src/app/plugins/types.ts`**:
```typescript
type PluginCategory = "interactive" | "automation" | "hybrid";
interface PluginContributions {
  bot?: { commands?, messageRoutes?, threadBridges? };
  worker?: { webhooks?, watchers?, schedules? };
  copilot?: { customAgents?, hooks? };
  policies?: PolicyDefinition[];
  reporters?: ReporterDefinition[];
}
interface Plugin {
  name: string;
  category: PluginCategory;
  contributions: PluginContributions;
  init?(context: PluginContext): Promise<void>;
  shutdown?(): Promise<void>;
}
```

**`src/app/plugins/registry.ts`**:
- `registerPlugin(plugin)`, `getPlugin(name)`, `getPlugins(category?)`
- Init plugins in dependency order
- Shutdown in reverse order
- Filter contributions by process type (bot vs worker)

### 1.4 — Bot entrypoint (thin wrapper)

**`src/bot/index.ts`**:
- Import config loader, plugin registry
- Load enabled plugins filtered to `interactive` and `hybrid`
- Initialize current bot logic (delegate to existing `createBot`)
- Start outbox publisher loop (no-op until Phase 2)
- Export `startBot()` function

### 1.5 — Worker entrypoint (skeleton)

**`src/worker/index.ts`**:
- Import config loader, plugin registry
- Load enabled plugins filtered to `automation` and `hybrid`
- Log "Worker started (no-op)" and keep process alive
- Export `startWorker()` function

### 1.6 — CLI updates

**`src/cli.ts`** changes:
- `ai-assistant start` → starts bot only (preserve backward compat)
- `ai-assistant start-bot` → explicit bot start
- `ai-assistant start-worker` → starts worker
- `ai-assistant start-all` → starts both (child processes or sequential)

### 1.7 — Package script updates

**`package.json`** new scripts:
- `start:bot` — `tsx src/bot/index.ts`
- `start:worker` — `tsx src/worker/index.ts`
- `start:all` — starts both
- `test` — `vitest`
- `test:run` — `vitest run`

### 1.8 — Vitest setup

- Install `vitest` as devDependency
- Create `vitest.config.ts` with TypeScript support
- Add first test: config loader unit test

### 1.9 — Phase 1 verification

- `ai-assistant start` still works (no regression)
- `ai-assistant start-worker` starts and exits cleanly
- `npm run build` passes
- `npm test` passes (config loader test)

---

## Phase 2: Shared Store and Outbox

**Goal**: SQLite database with migrations, repositories, and outbox pattern.

### 2.1 — Install better-sqlite3

- `npm install better-sqlite3`
- `npm install -D @types/better-sqlite3`
- Verify build still passes (better-sqlite3 has native addon)

### 2.2 — Database bootstrap

**`src/app/store/db.ts`**:
- Open/create `~/.ai-assistant/state/ops.db`
- Enable WAL mode for concurrent read access
- Set busy timeout for cross-process safety
- Export singleton `getDb()` accessor
- Handle graceful close on shutdown

### 2.3 — Migration system

**`src/app/store/migrations.ts`**:
- Sequential numbered migrations stored as functions
- `migrations` table tracks applied migrations
- Run pending migrations on startup
- Migrations are idempotent (CREATE TABLE IF NOT EXISTS)

### 2.4 — Initial migration (v001)

Create all initial tables:

```sql
-- Incidents
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,           -- 'alertmanager', 'grafana', 'influx', 'docker', 'manual'
  source_id TEXT,                 -- external alert ID for dedupe
  service_name TEXT,
  title TEXT NOT NULL,
  severity TEXT DEFAULT 'warning',
  status TEXT DEFAULT 'open',     -- open, acknowledged, investigating, resolved, closed
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  metadata TEXT                   -- JSON blob for source-specific data
);

-- Incident events (timeline)
CREATE TABLE incident_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  event_type TEXT NOT NULL,       -- 'created', 'acknowledged', 'note', 'action', 'resolved', etc.
  actor TEXT,                     -- 'system', 'worker', 'user:<discordId>'
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Notifications outbox
CREATE TABLE notifications_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  thread_id TEXT,                 -- NULL = create new thread, set after creation
  message_type TEXT NOT NULL,     -- 'alert', 'report', 'update', 'summary'
  payload TEXT NOT NULL,          -- JSON: { content, embeds, etc. }
  status TEXT DEFAULT 'pending',  -- pending, claimed, delivered, failed, retry
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  claimed_at TEXT,
  delivered_at TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Operator commands (bot → worker)
CREATE TABLE operator_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT REFERENCES incidents(id),
  command_type TEXT NOT NULL,     -- 'ack', 'note', 'action', 'escalate'
  actor TEXT NOT NULL,            -- 'user:<discordId>'
  payload TEXT,                   -- JSON
  status TEXT DEFAULT 'pending',  -- pending, claimed, executed, failed
  claimed_at TEXT,
  result TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Approval decisions
CREATE TABLE approval_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT REFERENCES incidents(id),
  action_name TEXT NOT NULL,
  requested_by TEXT NOT NULL,     -- 'worker'
  decided_by TEXT,                -- 'user:<discordId>'
  decision TEXT,                  -- 'approved', 'denied', 'timeout'
  reason TEXT,
  requested_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT
);

-- Plugin state (key-value per plugin)
CREATE TABLE plugin_state (
  plugin_name TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_name, key)
);

-- Schedule runs
CREATE TABLE schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_name TEXT NOT NULL,
  schedule_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending, running, completed, failed
  started_at TEXT,
  completed_at TEXT,
  result TEXT,                    -- JSON
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Audit events
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process TEXT NOT NULL,          -- 'bot', 'worker'
  event_type TEXT NOT NULL,
  actor TEXT,
  target TEXT,
  detail TEXT,                    -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);

-- Idempotency keys
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  result TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
```

### 2.5 — Repository modules

Each repository wraps a table with typed functions:

- **`src/app/store/incidents.ts`** — CRUD, status transitions, dedupe lookup by source_id
- **`src/app/store/outbox.ts`** — insert, claim (lease pattern), markDelivered, markFailed, retry logic
- **`src/app/store/operatorCommands.ts`** — insert, claim, markExecuted
- **`src/app/store/approvals.ts`** — request, decide, timeout check
- **`src/app/store/pluginState.ts`** — get/set per plugin
- **`src/app/store/audit.ts`** — append-only insert, query by type/actor
- **`src/app/store/scheduleRuns.ts`** — insert, start, complete, query last run

### 2.6 — Outbox publisher (bot-side)

**`src/bot/outboxPublisher.ts`**:
- Poll `notifications_outbox` for `status = 'pending'` rows
- Claim rows (lease pattern: set `claimed_at`, `status = 'claimed'`)
- Format payload and send to Discord via the client
- Mark delivered or failed with error detail
- Retry logic: re-queue failed rows up to max_attempts
- Configurable poll interval (default 5s)
- Thread creation: if `thread_id` is NULL and `message_type = 'alert'`, create thread and update row

### 2.7 — Store unit tests

- Migration execution and idempotency
- Outbox claim/deliver/retry lifecycle
- Incident dedupe logic
- Plugin state get/set

### 2.8 — Phase 2 verification

- Worker can write a notification row to outbox
- Bot can read, claim, and mark it delivered
- State persists across process restarts
- All tests pass

---

## Phase 3: Extract Chat Into `chat-core` Plugin

**Goal**: Move existing slash commands and mention handling under the plugin model without behavior changes.

### 3.1 — Create `chat-core` plugin structure

**`src/plugins/chat-core/index.ts`**:
```typescript
export const chatCorePlugin: Plugin = {
  name: "chat-core",
  category: "interactive",
  contributions: {
    bot: {
      commands: [...all current slash commands],
      messageRoutes: [mentionHandler, freeChannelHandler, threadHandler],
    },
  },
};
```

### 3.2 — Move slash command definitions

Move relevant portions of `src/commands.ts` into `src/plugins/chat-core/commands.ts`. The plugin contributes command definitions; the registry collects them.

### 3.3 — Move slash handlers

Move all files from `src/handlers/slash/` into `src/plugins/chat-core/handlers/`. Update imports.

### 3.4 — Move mention handler

Move `src/handlers/mention.ts` into `src/plugins/chat-core/handlers/mention.ts`.

### 3.5 — Move utils into shared or plugin

- `src/utils/downloadAttachments.ts` → stays in `src/utils/` (shared utility)
- `src/utils/resolveMessageLinks.ts` → stays in `src/utils/` (shared utility)

### 3.6 — Refactor bot.ts to use plugin registry

**`src/bot/discordClient.ts`** (renamed from `bot.ts`):
- Instead of hardcoded imports, get commands and routes from plugin registry
- Command router delegates to plugin-contributed handlers
- Message router delegates to plugin-contributed message routes

**`src/bot/commandRouter.ts`**:
- Receives slash command interactions
- Looks up handler from plugin registry
- Dispatches to correct handler

### 3.7 — Move SessionManager into shared layer

**`src/app/copilot/interactiveSessions.ts`**:
- Move `SessionManager` from `src/copilot.ts`
- Keep `McpConfigLoader` as shared utility
- Move `chunkForDiscord` to `src/utils/discord.ts`

### 3.8 — Update src/index.ts

Thin wrapper that calls `startBot()` from `src/bot/index.ts`. Preserves backward compat.

### 3.9 — Backward compatibility test

- `/ask`, `/chat`, `/reset`, mentions, free channels, bot threads all work unchanged
- `ai-assistant start` still works
- Build passes, all existing tests pass

---

## Phase 4: Worker Skeleton

**Goal**: HTTP server, scheduler, health endpoints, audit wiring.

### 4.1 — Install Fastify

- `npm install fastify`
- `npm install -D @types/node` (already present)

### 4.2 — Worker HTTP server

**`src/worker/httpServer.ts`**:
- Create Fastify instance
- Register routes from plugin-contributed webhooks
- Health endpoint: `GET /health` → `{ status: "ok", uptime, plugins }`
- Bind to configured host/port (default `127.0.0.1:8780`)
- HMAC verification hook for webhook routes (plugin-configurable)

### 4.3 — Scheduler

**`src/worker/scheduler.ts`**:
- Cron-like scheduler using `setInterval` + schedule expressions
- Register schedules from plugin contributions
- Track runs in `schedule_runs` table
- Skip if previous run still in progress
- Log start/complete/error to audit

### 4.4 — Worker health

**`src/worker/health.ts`**:
- Report: uptime, active schedules, last webhook received, database status
- Expose via health endpoint and as a CLI queryable

### 4.5 — Bot health updates

**`src/bot/health.ts`**:
- Add worker health check (HTTP call to worker's health endpoint)
- `/status` command shows both bot and worker health

### 4.6 — Audit wiring

Wire `audit.ts` repository into both processes:
- Bot: audit slash commands, outbox deliveries
- Worker: audit webhook receives, schedule runs, actions

### 4.7 — Worker entrypoint completion

**`src/worker/index.ts`**:
- Load config and plugins
- Initialize database (run migrations)
- Start HTTP server
- Start scheduler
- Start plugin watchers
- Graceful shutdown (close HTTP, stop schedules, close DB)

### 4.8 — Phase 4 verification

- Worker accepts a test webhook (curl → 200)
- Worker runs a scheduled no-op task (visible in schedule_runs)
- Both processes expose health status
- Tests pass

---

## Phase 5: Incident Engine and Bot Bridge

**Goal**: Incident lifecycle, Discord thread creation, operator command bridge, approval flow.

### 5.1 — Incident engine

**`src/worker/incidentEngine.ts`**:
- State machine: `open → acknowledged → investigating → resolved → closed`
- Create incident from normalized event
- Dedupe: check `source_id` before creating
- Update severity, merge metadata
- Auto-resolve after configurable cooldown if no new events
- Write timeline events to `incident_events`

### 5.2 — Outbox formatters

**`src/bot/outboxPublisher.ts`** enhancements:
- Format `alert` messages as Discord embeds (severity color, service name, timestamp)
- Format `report` messages as summary embeds
- Format `update` messages as thread replies
- Thread creation on first alert for an incident
- Store `thread_id` back in outbox row and `incidents` metadata

### 5.3 — Incident bridge (bot → worker)

**`src/bot/incidentBridge.ts`**:
- Detect messages in incident threads (thread owned by bot, metadata links to incident)
- Parse user intent: ack, note, action request
- Insert `operator_commands` row
- Reply with confirmation ("📝 Command queued for worker")

### 5.4 — Operator command processor (worker)

**`src/worker/delivery.ts`**:
- Poll `operator_commands` for pending rows
- Claim and execute:
  - `ack` → transition incident to acknowledged
  - `note` → append to incident events
  - `action` → validate against policy, queue for execution
  - `escalate` → write outbox notification to escalation channel

### 5.5 — Approval flow

**`src/worker/incidentEngine.ts`** extension:
- Before executing dangerous actions, insert `approval_decisions` row
- Write outbox notification: "🔒 Action `restart_service` requires approval"
- Bot presents approval buttons (Discord components)
- User clicks approve/deny → bot inserts decision
- Worker picks up decision, proceeds or aborts

**`src/bot/incidentBridge.ts`** extension:
- Handle button interactions for approvals
- Insert `approval_decisions` row with decision

### 5.6 — Thread tracking

Add `thread_id` column to `incidents` table (migration v002):
```sql
ALTER TABLE incidents ADD COLUMN thread_id TEXT;
```

### 5.7 — Phase 5 verification

- Incoming alert creates an incident
- Outbox row triggers Discord thread creation
- User reply in thread reaches worker as operator command
- Approval flow: request → button → decision → execution
- Tests for state machine transitions, dedupe, outbox formatting

---

## Phase 6: `sre-docker-host` Plugin

**Goal**: Reference hybrid plugin with real webhook receivers, Docker watcher, diagnostics, and safe restart.

### 6.1 — Plugin skeleton

**`src/plugins/sre-docker-host/index.ts`**:
```typescript
export const sreDockerHostPlugin: Plugin = {
  name: "sre-docker-host",
  category: "hybrid",
  contributions: {
    bot: { commands: [opsStatus, incidentList, incidentAck, incidentNote, reportNow] },
    worker: {
      webhooks: [alertmanagerReceiver, grafanaReceiver, influxReceiver],
      watchers: [dockerWatcher],
      schedules: [dailyReport, weeklyReport],
    },
    copilot: { customAgents: [sreResearcher, sreRemediator, reportWriter] },
    policies: [restartPolicy, diagnosticsPolicy],
  },
};
```

### 6.2 — Webhook normalizers

**`src/plugins/sre-docker-host/webhooks.ts`**:

- **Alertmanager**: Parse generic webhook payload → `{ source: "alertmanager", source_id, service_name, title, severity, metadata }`
- **Grafana**: Parse webhook with HMAC verification → normalized event
- **InfluxDB**: Parse notification endpoint payload → normalized event

Each normalizer produces a common `NormalizedAlert` type that feeds into the incident engine.

### 6.3 — Docker event watcher

**`src/plugins/sre-docker-host/dockerWatcher.ts`**:
- Connect to Docker socket (`/var/run/docker.sock`)
- Filter events: `die`, `oom-kill`, `restart`, `health_status`
- Normalize to `NormalizedAlert`
- Feed into incident engine
- Handle reconnection on socket errors

### 6.4 — Docker adapter

**`src/adapters/docker.ts`**:
- Docker Engine API client (HTTP over Unix socket)
- `listContainers()`, `inspectContainer()`, `getContainerLogs()`, `restartContainer()`
- `getEvents(filters)` → async iterator
- Service lookup from workspace path (read docker-compose files)

### 6.5 — Service lookup

**`src/plugins/sre-docker-host/serviceLookup.ts`**:
- Read `docker-compose.yml` files from configured workspace path
- Map container names → service definitions
- Provide context for diagnostics (ports, volumes, dependencies)

### 6.6 — Diagnostics collector

**`src/plugins/sre-docker-host/diagnostics.ts`**:
- `collect_diagnostics` action:
  - Container inspect (state, health, restart count)
  - Recent logs (last 100 lines)
  - Resource usage (CPU, memory from Docker stats)
  - Compose service definition
  - Related container health
- Output as structured JSON for Copilot agent consumption

### 6.7 — Safe restart flow

**`src/plugins/sre-docker-host/restart.ts`**:
- `restart_service` action:
  - Pre-check: is service in allowlist?
  - Pre-check: cooldown not exceeded?
  - Pre-check: approval if required?
  - Execute: `docker restart <container>` with timeout
  - Verify: wait for healthy status
  - Report: write result to incident events and outbox

### 6.8 — Bot commands

**`src/plugins/sre-docker-host/commands.ts`**:
- `/ops status` — overview of active incidents, worker health
- `/incident list` — list open incidents with severity and age
- `/incident ack <id>` — acknowledge an incident
- `/incident note <id> <text>` — add a note to an incident
- `/report now <type>` — trigger an on-demand report

### 6.9 — Report templates

**`src/plugins/sre-docker-host/reports.ts`**:
- Daily health report: active incidents, container health summary, restart counts
- Weekly noisy-alert report: top alerting services, alert frequency
- Flapping container report: containers with >N restarts in period
- Failed restart report: services that failed to recover
- Certificate expiry report: TLS cert check via adapters
- Disk/inode pressure report: host filesystem checks

### 6.10 — Copilot custom agents

**`src/plugins/sre-docker-host/agents.ts`**:
- `sre-researcher`: read-only agent with Docker inspect, logs, metrics access
- `sre-remediator`: action agent with restart, diagnostics, verification tools
- `report-writer`: summarization agent for report generation

### 6.11 — Payload fixtures and tests

- Alertmanager webhook payload fixtures (firing, resolved)
- Grafana webhook payload fixtures (alerting, ok)
- InfluxDB notification fixtures
- Docker event JSON fixtures (die, oom, restart, health_status)
- Unit tests for each normalizer
- Integration test: webhook → incident → outbox

### 6.12 — Phase 6 verification

- Real Alertmanager/Grafana/InfluxDB payloads map to incidents
- Docker events (die, oom, restart, health_status) captured
- Worker collects diagnostics for a container
- Worker restarts a configured service (with approval if required)
- Reports generate and post via outbox

---

## Phase 7: Guardrails and Policy Engine

**Goal**: Cooldowns, dedupe, maintenance windows, tool restrictions, session cleanup.

### 7.1 — Policy engine core

**`src/app/policies/engine.ts`**:
- Evaluate policy rules against action context
- Return: `{ allowed: boolean, reason?: string, requiresApproval?: boolean }`
- Support rule types: allowlist, denylist, cooldown, rate limit, maintenance window

**`src/app/policies/types.ts`**:
```typescript
interface PolicyContext {
  action: string;
  service?: string;
  severity?: string;
  lastActionAt?: Date;
  incidentAge?: number;
}
interface PolicyRule {
  type: 'allowlist' | 'denylist' | 'cooldown' | 'rateLimit' | 'maintenanceWindow';
  config: Record<string, unknown>;
}
```

### 7.2 — Cooldown and dedupe

- Cooldown: prevent same action on same service within N minutes
- Dedupe: suppress duplicate alerts within a configurable window
- Track in `plugin_state` or dedicated columns on incidents

### 7.3 — Maintenance windows

- Config-driven: `{ dayOfWeek, startHour, endHour, timezone }`
- During window: suppress non-critical alerts, defer remediation
- Post-window: process queued items

### 7.4 — Severity mapping

- Map alert source severity → internal severity (critical, warning, info)
- Configurable per source in plugin config
- Severity determines: notification urgency, auto-remediation eligibility, approval requirements

### 7.5 — Hook-based tool restrictions

**`src/app/copilot/hooks.ts`**:
- `onPreToolUse`: check action against policy engine before executing
- `onPostToolUse`: redact secrets from tool output, log to audit
- `onSessionStart`: inject incident metadata, restrict tool set
- `onErrorOccurred`: retry transient failures, escalate permanent ones
- `onSessionEnd`: cleanup, write metrics

### 7.6 — Session cleanup and retention

- Auto-disconnect idle worker sessions after configurable timeout
- Purge `idempotency_keys` older than TTL
- Archive resolved incidents after retention period
- Compact audit log (retain summaries, purge detail after N days)

### 7.7 — Policy tests

- Cooldown enforcement
- Dedupe window behavior
- Maintenance window calculations
- Allowlist/denylist evaluation
- Hook integration tests

### 7.8 — Phase 7 verification

- Dangerous actions require approval
- Duplicate alerts within window are suppressed
- Maintenance window defers non-critical work
- Automation sessions produce audit records for each tool call
- All tests pass

---

## Phase 8: Docs, Setup, and Packaging

**Goal**: Updated README, setup wizard, dual systemd services, public documentation.

### 8.1 — README rewrite

- Architecture overview with diagram
- Quick start: one install, choose bot-only or bot+worker
- Configuration reference: `.env`, `config.json`
- Plugin documentation: chat-core, sre-docker-host
- CLI command reference
- Webhook setup guide (reverse proxy, HMAC)

### 8.2 — Setup wizard updates

**`src/cli.ts`** `setup()` changes:
- After Discord config, ask: "Enable SRE automation? [y/N]"
- If yes: prompt for workspace path, webhook port, alert channel IDs
- Write `config.json` with plugin config
- Offer to install both systemd services

### 8.3 — Dual systemd services

**`ai-assistant-bot.service`**:
- `ExecStart=... cli.js start-bot`

**`ai-assistant-worker.service`**:
- `ExecStart=... cli.js start-worker`
- `After=ai-assistant-bot.service` (soft dependency)

**`ai-assistant.target`** (optional):
- Groups both services

Update `install-service` command to install both units.

### 8.4 — Reference plugin config documentation

- Example `config.json` with all plugin options documented
- Webhook payload examples for each source
- Docker workspace setup guide
- Auto-remediation allowlist documentation

### 8.5 — Phase 8 verification

- Fresh install path: `npm install -g` → `setup` → `start` works
- Bot-only mode: no worker artifacts or errors
- Bot+worker mode: both services running, health endpoints accessible
- README accurately describes all commands and config options

---

## Dependency Summary

| Package | Purpose | Phase |
|---------|---------|-------|
| `vitest` (dev) | Test runner | 1 |
| `better-sqlite3` | SQLite database | 2 |
| `@types/better-sqlite3` (dev) | Types | 2 |
| `fastify` | Worker HTTP server | 4 |

## Risk Notes

- **better-sqlite3 native addon**: Requires build tools. May need `node-gyp` in CI. Test on WSL early.
- **SQLite WAL mode**: Works for 2 processes on same host. Not suitable for NFS mounts.
- **Docker socket access**: Worker needs `/var/run/docker.sock`. Document permission setup.
- **WSL path handling**: `fs.realpathSync` on `/mnt/e/...` paths. Test explicitly.
- **Fastify + TypeScript**: Use `@fastify/type-provider-typebox` or manual types.

## File Migration Map

| Current | New Location | Phase |
|---------|-------------|-------|
| `src/index.ts` | `src/index.ts` (thin wrapper → `startBot()`) | 3 |
| `src/bot.ts` | `src/bot/discordClient.ts` + `src/bot/commandRouter.ts` | 3 |
| `src/copilot.ts` SessionManager | `src/app/copilot/interactiveSessions.ts` | 3 |
| `src/copilot.ts` McpConfigLoader | `src/app/copilot/mcpConfig.ts` | 3 |
| `src/copilot.ts` chunkForDiscord | `src/utils/discord.ts` | 3 |
| `src/commands.ts` | `src/plugins/chat-core/commands.ts` | 3 |
| `src/handlers/slash/*` | `src/plugins/chat-core/handlers/` | 3 |
| `src/handlers/mention.ts` | `src/plugins/chat-core/handlers/mention.ts` | 3 |
| `src/utils/*` | `src/utils/*` (stays) | — |
| `src/cli.ts` | `src/cli.ts` (extended) | 1, 8 |
