# AI Assistant

AI-powered Discord assistant with SRE automation — powered by the [GitHub Copilot SDK](https://github.com/github/copilot-sdk).

Chat with Copilot from Discord, monitor Docker infrastructure, receive alerts from Prometheus/Grafana/InfluxDB, and manage incidents — all through a conversational interface with full tool access.

## Architecture

```
┌──────────────────┐         ┌──────────────────────┐
│   Bot Process     │         │   Worker Process      │
│                   │         │                       │
│  Discord Gateway  │         │  HTTP Webhooks        │
│  Slash Commands   │         │  Docker Event Watcher │
│  Outbox Publisher │         │  Scheduler (reports)  │
│  Copilot Sessions │         │  Incident Engine      │
│  Chat / Mentions  │         │  Approval Processor   │
└────────┬──────────┘         └───────────┬───────────┘
         │                                │
         │    ┌────────────────────┐      │
         └───►│  SQLite (ops.db)   │◄─────┘
              │  shared durable    │
              │  state             │
              └────────────────────┘

External:
  Alertmanager ──► POST /webhooks/alertmanager  ──► Worker
  Grafana      ──► POST /webhooks/grafana       ──► Worker
  InfluxDB     ──► POST /webhooks/influxdb      ──► Worker
  Servarr      ──► POST /webhooks/servarr       ──► Worker
  Seerr        ──► POST /webhooks/seerr         ──► Worker
  Uptime Kuma  ──► POST /webhooks/uptime-kuma   ──► Worker
  Docker       ──► Event stream                 ──► Worker
```

The **bot process** connects to Discord and handles all user interactions. The **worker process** runs an HTTP server for webhooks, watches Docker events, runs scheduled reports, and manages incidents. Both processes share a single SQLite database (`~/.ai-assistant/state/ops.db`) for durable state.

## Features

- **Interactive AI chat** — GitHub Copilot SDK with thread-based sessions, persistent history, and model switching
- **MCP tool support** — filesystem, Docker, web search, and custom MCP servers via `.vscode/mcp.json`
- **Incident management** — webhooks from Alertmanager, Grafana, InfluxDB, Servarr, Seerr, and Uptime Kuma create incidents with timeline tracking and Discord threads
- **Docker monitoring** — real-time container event watching (die, OOM, restart, health changes) with automatic incident creation
- **Operator commands** — acknowledge, annotate, and manage incidents via Discord slash commands and threads
- **Approval workflows** — destructive actions (e.g., container restarts) require operator approval via Discord buttons
- **Scheduled reports** — daily health and weekly summary reports posted to a configured channel
- **Policy engine** — cooldowns, rate limits, maintenance windows, and service allowlists for auto-remediation
- **Custom agents** — SRE researcher (read-only), remediator (action-capable), and report writer agents

## Quick Start

### Prerequisites

- **Node.js 20+**
- A [Discord application](https://discord.com/developers/applications) with a bot user
- The [`gh` CLI](https://cli.github.com/) authenticated with a GitHub account that has **Copilot access**

### Install

```bash
npm install -g --install-links github:Rubiss/ai-assistant-copilot-sdk
```

### Setup

```bash
ai-assistant setup
```

The interactive wizard prompts for Discord credentials and optionally configures SRE automation (Docker monitoring, webhooks, incident management).

### Start

```bash
# Bot only (Discord chat, slash commands)
ai-assistant start

# Bot + Worker (full SRE automation)
ai-assistant start-all
```

### Update

```bash
npm install -g --install-links github:Rubiss/ai-assistant-copilot-sdk
```

## Configuration

All configuration lives in `~/.ai-assistant/` (override with `AI_ASSISTANT_CONFIG_DIR`).

### `.env` — Credentials & environment

```env
# Required
DISCORD_TOKEN=           # Bot token from Discord Developer Portal → Bot
DISCORD_APP_ID=          # Application ID from General Information
DISCORD_GUILD_ID=        # Server ID for slash command registration

# Optional
DISCORD_FREE_CHANNELS=   # Comma-separated channel IDs (bot replies without @mention)
DISCORD_ALLOWED_USERS=   # Comma-separated user IDs (leave empty to allow all)
COPILOT_TIMEOUT_MS=      # Agent response timeout (default: 600000 = 10 min)

# MCP server secrets (format: MCP_INPUT_<ID_UPPERCASE>)
# MCP_INPUT_GRAFANA_SERVICE_ACCOUNT_TOKEN=your_token
```

### `config.json` — Runtime configuration

```json
{
  "plugins": {
    "chat-core": { "enabled": true },
    "sre-docker-host": {
      "enabled": true,
      "workspacePath": "/home/user/docker",
      "webhookPort": 8780,
      "alertChannelId": "123456789012345678",
      "escalationChannelId": "987654321098765432"
    }
  }
}
```

See [docs/configuration.md](docs/configuration.md) for the complete reference.

## CLI Commands

| Command | Description |
|---------|-------------|
| `setup` | Interactive first-run wizard — creates `~/.ai-assistant/.env` and `config.json` |
| `start` / `start-bot` | Start the bot process (Discord gateway, slash commands) |
| `start-worker` | Start the worker process (HTTP webhooks, scheduler, Docker monitor) |
| `start-all` | Start both bot and worker processes |
| `deploy-commands` | Register Discord slash commands with the API |
| `install-service` | Generate and install systemd unit files for bot and/or worker |
| `update` | Print update instructions |

### Environment

| Variable | Description |
|----------|-------------|
| `AI_ASSISTANT_CONFIG_DIR` | Override config directory (default: `~/.ai-assistant`) |
| `NODE_ENV` | Set to `production` in systemd services |

## Plugins

### `chat-core` (interactive)

The default plugin — provides all interactive Discord chat functionality.

| Command | Description |
|---------|-------------|
| `/ask <prompt>` | One-shot question (ephemeral, no history) |
| `/chat <message>` | Persistent conversation in a new thread (or continue in current thread/DM) |
| `/reset` | Clear conversation history |
| `/model list\|set\|current` | List, switch, or show the active Copilot model |
| `/agent list\|select\|deselect` | Manage custom agents for your session |
| `/mcp list\|enable\|disable\|workspace` | Manage MCP servers |
| `/mode get\|set` | Switch session mode (interactive, plan, autopilot) |
| `/plan read\|update\|delete` | Manage the session plan |
| `/workspace list\|read\|create` | Manage workspace files |
| `/compact` | Compact session context to free token space |
| `/fleet [prompt]` | Start fleet mode for the session |
| `/status` | Copilot auth status and version |
| `/history [count]` | Show recent conversation exchanges |
| `/servers` | List servers the bot is installed in |
| `/leave <guild_id>` | Remove bot from a server |

**Mentions & free channels**: The bot responds to `@mentions` in any channel. Channels listed in `DISCORD_FREE_CHANNELS` don't require a mention. Bot-owned threads are always free.

**File attachments**: Attach images to `/ask` or `/chat` for Copilot to analyze.

### `sre-docker-host` (hybrid)

SRE automation plugin — contributes to both bot and worker processes.

| Command | Description |
|---------|-------------|
| `/ops` | Operational status overview (open/acked/investigating incidents) |
| `/incident list` | List open incidents |
| `/incident ack <id>` | Acknowledge an incident |
| `/incident note <id> <text>` | Add a note to an incident timeline |
| `/report now <daily\|weekly>` | Generate a report on demand |

**Webhook endpoints** (worker HTTP server):

| Endpoint | Source |
|----------|--------|
| `POST /webhooks/alertmanager` | Prometheus Alertmanager |
| `POST /webhooks/grafana` | Grafana Alerting |
| `POST /webhooks/influxdb` | InfluxDB Checks |
| `POST /webhooks/servarr` | Sonarr, Radarr, Prowlarr, Lidarr, Readarr |
| `POST /webhooks/seerr` | Overseerr / Jellyseerr |
| `POST /webhooks/uptime-kuma` | Uptime Kuma |

**Docker watcher**: Monitors container events (die, OOM, restart, health status changes) and creates incidents automatically.

**Scheduled reports**: Daily health report and weekly summary, posted to the configured alert channel.

**Custom agents**: `sre-researcher` (read-only inspection), `sre-remediator` (action-capable), `report-writer` (report generation).

## Webhook Setup

The worker process runs an HTTP server on `0.0.0.0:8780` by default (all interfaces). Use a firewall or reverse proxy to restrict access in production.

### HMAC Verification

Set an HMAC secret env var in your `.env` file and reference it in the webhook route's `hmacSecretEnv` field. The server checks the `X-Hub-Signature-256` header using SHA-256 HMAC.

### Reverse Proxy (nginx)

```nginx
upstream ai-assistant-worker {
    server 127.0.0.1:8780;
}

server {
    listen 443 ssl;
    server_name alerts.example.com;

    ssl_certificate     /etc/letsencrypt/live/alerts.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/alerts.example.com/privkey.pem;

    location /webhooks/ {
        proxy_pass http://ai-assistant-worker;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://ai-assistant-worker;
    }
}
```

### Alertmanager Configuration

```yaml
# alertmanager.yml
receivers:
  - name: ai-assistant
    webhook_configs:
      - url: http://127.0.0.1:8780/webhooks/alertmanager
        send_resolved: true
```

### Grafana Contact Point

In Grafana → Alerting → Contact points, add a webhook:
- **URL**: `http://127.0.0.1:8780/webhooks/grafana`
- **HTTP Method**: POST

### InfluxDB Checks

In InfluxDB → Alerts → Notification Endpoints, create an HTTP endpoint:
- **URL**: `http://host.docker.internal:8780/webhooks/influxdb`
- **Method**: POST
- Then create a Notification Rule that sends check statuses to this endpoint

### Servarr (Sonarr / Radarr / Prowlarr / Lidarr / Readarr)

In each app → Settings → Connect → add a Webhook:
- **URL**: `http://host.docker.internal:8780/webhooks/servarr` (adjust host for your setup)
- **Method**: POST
- **Events**: Select **On Health Issue**, **On Health Restored**, and **On Application Update** only. Notification events (Grab, Download, etc.) are ignored by the normalizer.

### Seerr (Overseerr / Jellyseerr)

In Settings → Notifications → Webhook:
- **Webhook URL**: `http://host.docker.internal:8780/webhooks/seerr`
- **Notification Types**: Enable **Media Failed** only (other types are ignored)

### Uptime Kuma

In Settings → Notifications → Setup Notification:
- **Type**: Webhook
- **Post URL**: `http://host.docker.internal:8780/webhooks/uptime-kuma`
- **Content Type**: `application/json`
- Leave the body as default — the normalizer expects the standard `{ heartbeat, monitor, msg }` payload
- Check **Apply on all existing monitors** to enable for all monitors

## Systemd Services

Install both services with:

```bash
ai-assistant install-service
```

This creates two unit files:

- `ai-assistant-bot.service` — Discord bot process
- `ai-assistant-worker.service` — Worker process (depends on bot)

The legacy `ai-assistant.service` is also installed for backward compatibility (runs the bot).

### Manual management

```bash
# Start/stop individually
sudo systemctl start ai-assistant-bot
sudo systemctl start ai-assistant-worker

# Start both
sudo systemctl start ai-assistant-bot ai-assistant-worker

# View logs
sudo journalctl -u ai-assistant-bot -f
sudo journalctl -u ai-assistant-worker -f

# Restart after update
sudo systemctl restart ai-assistant-bot ai-assistant-worker
```

## Development

### Build

```bash
npm install
npm run build      # tsc
```

### Test

```bash
npm test           # vitest (watch mode)
npx vitest run     # single run
```

### Project Structure

```
src/
  cli.ts                          # CLI entry point (setup, start, install-service)
  bot/
    index.ts                      # startBot() — Discord gateway, outbox publisher
    discordClient.ts              # Discord.js client setup
    commandRouter.ts              # Slash command dispatch
    outboxPublisher.ts            # Polls outbox table, delivers to Discord
    incidentBridge.ts             # Links incidents to Discord threads
  worker/
    index.ts                      # startWorker() — HTTP server, scheduler, watchers
    httpServer.ts                 # Fastify server with HMAC verification
    incidentEngine.ts             # Alert → incident state machine
    scheduler.ts                  # Interval-based schedule runner
    approvalProcessor.ts          # Polls approval decisions, executes actions
    delivery.ts                   # Message delivery helpers
    health.ts                     # /health endpoint data
  app/
    config/
      env.ts                      # Environment variable loading
      runtimeConfig.ts            # config.json loader
      validate.ts                 # Config validation
    store/
      db.ts                       # SQLite connection (better-sqlite3)
      incidents.ts                # Incident CRUD
      outbox.ts                   # Outbox message queue
      approvals.ts                # Approval request/decision store
      audit.ts                    # Audit log
      migrations/                 # Database migrations
    plugins/
      registry.ts                 # Plugin registration and lifecycle
      types.ts                    # Plugin interfaces
    policies/
      engine.ts                   # Policy evaluation engine
      cooldown.ts                 # Action cooldown tracking
      maintenance.ts              # Maintenance window checks
      types.ts                    # Policy rule types
    copilot/
      interactiveSessions.ts      # Copilot SDK session management
  plugins/
    chat-core/                    # Interactive chat plugin
      commands.ts                 # Slash command definitions
      handlers/                   # Command handlers (ask, chat, model, etc.)
      index.ts                    # Plugin registration
    sre-docker-host/              # SRE automation plugin
      commands.ts                 # /ops, /incident, /report commands
      webhooks.ts                 # Webhook normalizers (Alertmanager, Grafana, InfluxDB, Servarr, Seerr, Uptime Kuma)
      dockerWatcher.ts            # Docker event stream consumer
      diagnostics.ts              # Container diagnostics collector
      restart.ts                  # Safe restart with cooldown + approval
      reports.ts                  # Daily/weekly report generators
      agents.ts                   # Custom Copilot agents
      serviceLookup.ts            # Docker Compose service resolution
      index.ts                    # Plugin registration
  adapters/
    docker.ts                     # Docker Engine API client
  utils/
    discord.ts                    # Discord helper utilities
    downloadAttachments.ts        # Attachment download for Copilot
    resolveMessageLinks.ts        # Discord message link resolution
scripts/
  register-commands.ts            # Slash command registration script
  install-service.sh              # Legacy systemd installer
docs/
  configuration.md                # Complete configuration reference
ai-assistant-bot.service          # systemd unit template (bot)
ai-assistant-worker.service       # systemd unit template (worker)
ai-assistant.service              # systemd unit template (legacy, backward-compatible)
```

## Uninstall

```bash
# Stop and remove systemd services
sudo systemctl stop ai-assistant-bot ai-assistant-worker
sudo systemctl disable ai-assistant-bot ai-assistant-worker
sudo rm /etc/systemd/system/ai-assistant-bot.service
sudo rm /etc/systemd/system/ai-assistant-worker.service
sudo rm /etc/systemd/system/ai-assistant.service
sudo systemctl daemon-reload

# Remove the npm package
npm uninstall -g ai-assistant

# Remove config and state (optional — destructive)
rm -rf ~/.ai-assistant
```

## Security Notes

- All credentials live in `~/.ai-assistant/.env` — git-ignored, never committed.
- Use `DISCORD_ALLOWED_USERS` to restrict access — the bot has full tool access to the host.
- The bot uses `approveAll` permissions — it executes any tool Copilot requests without prompting.
- Destructive worker actions (container restart) require operator approval via Discord buttons.
- Thread sessions are isolated by thread ID.
- Webhook HMAC verification is supported for all endpoints.
- The worker HTTP server binds to `0.0.0.0` by default — use a firewall or reverse proxy to restrict access. HMAC verification is supported via the `hmacSecretEnv` route option but is not enabled by default on any endpoint.
