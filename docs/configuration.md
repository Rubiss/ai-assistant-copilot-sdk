# Configuration Reference

Complete configuration reference for AI Assistant.

All configuration files are stored in `~/.ai-assistant/` unless overridden with the `AI_ASSISTANT_CONFIG_DIR` environment variable.

## Directory Layout

```
~/.ai-assistant/
  .env                # Credentials and environment variables
  config.json         # Runtime plugin configuration
  state/
    ops.db            # SQLite database (incidents, outbox, audit log, etc.)
```

## Environment Variables (`.env`)

### Required

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from [Discord Developer Portal](https://discord.com/developers/applications) → Bot |
| `DISCORD_APP_ID` | Application ID from General Information |
| `DISCORD_GUILD_ID` | Server ID for slash command registration |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_FREE_CHANNELS` | _(empty)_ | Comma-separated channel IDs where bot replies without `@mention` |
| `DISCORD_ALLOWED_USERS` | _(empty)_ | Comma-separated user IDs allowed to use the bot (empty = all users) |
| `COPILOT_TIMEOUT_MS` | `600000` | Timeout in milliseconds for Copilot agent responses (10 min default) |

### MCP Server Secrets

MCP servers configured in `.vscode/mcp.json` can reference `${input:xxx}` variables. Set them as environment variables with the format:

```
MCP_INPUT_<ID_UPPERCASE>=value
```

Hyphens in the ID become underscores. Examples:

```env
MCP_INPUT_GRAFANA_SERVICE_ACCOUNT_TOKEN=glsa_xxxx
MCP_INPUT_PORTAINER_API_TOKEN=ptr_xxxx
```

### System-Level Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_ASSISTANT_CONFIG_DIR` | `~/.ai-assistant` | Override the configuration directory |
| `NODE_ENV` | _(empty)_ | Set to `production` in systemd services |

## Runtime Configuration (`config.json`)

### Complete Example

```json
{
  "plugins": {
    "chat-core": {
      "enabled": true
    },
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

### Plugin: `chat-core`

The interactive chat plugin. Enabled by default.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the plugin |

No additional configuration — all settings come from `.env` and Discord command options.

### Plugin: `sre-docker-host`

SRE automation plugin for Docker monitoring, webhooks, and incident management.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable/disable the plugin |
| `workspacePath` | `string` | — | Path to Docker workspace (where docker-compose files live) |
| `webhookPort` | `number` | `8780` | HTTP server port for incoming webhooks |
| `alertChannelId` | `string` | — | Discord channel ID for incident notifications |
| `escalationChannelId` | `string` | — | Discord channel ID for escalations (optional) |

## Webhook Payloads

### Alertmanager

**Endpoint:** `POST /webhooks/alertmanager`

```json
{
  "version": "4",
  "groupKey": "{}:{alertname=\"HighCPU\"}",
  "status": "firing",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "HighCPU",
        "severity": "warning",
        "service": "nginx",
        "instance": "localhost:9090",
        "job": "node-exporter"
      },
      "annotations": {
        "summary": "CPU usage above 90% for 5 minutes",
        "description": "The node-exporter instance localhost:9090 has CPU > 90%"
      },
      "startsAt": "2024-01-15T10:30:00.000Z",
      "endsAt": "0001-01-01T00:00:00Z",
      "fingerprint": "abc123def456"
    }
  ]
}
```

**Severity mapping:**
- `critical`, `error` → `critical`
- `warning` → `warning`
- Everything else → `info`

**Service resolution** (in order): `labels.service` → `labels.job` → `labels.instance`

### Grafana

**Endpoint:** `POST /webhooks/grafana`

```json
{
  "status": "alerting",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "DiskSpaceLow",
        "severity": "critical",
        "service": "media-server",
        "grafana_folder": "Infrastructure"
      },
      "annotations": {
        "summary": "Disk space below 10% on /data",
        "description": "The /data partition has less than 10% free space"
      },
      "fingerprint": "xyz789",
      "startsAt": "2024-01-15T10:30:00.000Z",
      "endsAt": "0001-01-01T00:00:00Z",
      "values": {
        "B": 8.2
      }
    }
  ]
}
```

**Severity mapping:** Same as Alertmanager.

**Service resolution** (in order): `labels.service` → `labels.grafana_folder`

### InfluxDB

**Endpoint:** `POST /webhooks/influxdb`

```json
{
  "_check_id": "0a1b2c3d4e5f",
  "_check_name": "Memory Usage Critical",
  "_level": "crit",
  "_message": "Memory usage exceeds 95% on host-01",
  "_source_measurement": "mem",
  "_type": "threshold"
}
```

**Severity mapping:**
- `crit` → `critical`
- `warn` → `warning`
- Everything else → `info`

**Status mapping:** `_level: "ok"` → `resolved`, everything else → `firing`

### Servarr (Sonarr / Radarr / Prowlarr / Lidarr / Readarr)

**Endpoint:** `POST /webhooks/servarr`

All Servarr apps use the same webhook payload format.

**Health event:**

```json
{
  "eventType": "Health",
  "instanceName": "Sonarr",
  "isHealthy": false,
  "messages": [
    {
      "type": "Error",
      "message": "No indexers available with RSS sync enabled",
      "source": "IndexerRssCheck",
      "wikiUrl": "https://wiki.servarr.com/sonarr/system#no-indexers-available-with-rss-sync-enabled",
      "level": 2
    }
  ]
}
```

**ApplicationUpdate event:**

```json
{
  "eventType": "ApplicationUpdate",
  "instanceName": "Radarr",
  "previousVersion": "5.2.6.8376",
  "newVersion": "5.3.6.8612"
}
```

**Alert event types** (all others are ignored):
- `Health` → firing alert (severity from `messages[].type` and `messages[].level`: `Error`/level 2=critical, `Warning`/level 1=warning, else info; `type` is checked first)
- `HealthRestored` → resolved alert
- `ApplicationUpdate` → info-level firing alert

**Ignored events:** `Grab`, `Download`, `Rename`, `MovieAdded`, `SeriesAdd`, `EpisodeFileDelete`, and all other notification-type events.

### Seerr (Overseerr / Jellyseerr)

**Endpoint:** `POST /webhooks/seerr`

```json
{
  "notification_type": "MEDIA_FAILED",
  "event": "Media Failed",
  "subject": "Failed Request - The Matrix (1999)",
  "message": "The request for The Matrix (1999) has failed.",
  "media": {
    "media_type": "movie",
    "tmdbId": "603",
    "tvdbId": "",
    "status": "UNKNOWN",
    "status4k": "UNKNOWN"
  },
  "request": {
    "request_id": "42",
    "requestedBy_username": "rubiss"
  }
}
```

**Alert types** (all others are ignored):
- `MEDIA_FAILED` → warning-level firing alert

**Ignored types:** `MEDIA_PENDING`, `MEDIA_APPROVED`, `MEDIA_AVAILABLE`, `MEDIA_DECLINED`, `TEST_NOTIFICATION`, and all others.

### Uptime Kuma

**Endpoint:** `POST /webhooks/uptime-kuma`

Uses Uptime Kuma's default webhook body format (do not customize the payload template).

**DOWN event:**

```json
{
  "heartbeat": {
    "status": 0,
    "msg": "Connection failed",
    "time": "2024-06-01T12:00:00.000Z",
    "ping": null,
    "duration": 300,
    "important": true
  },
  "monitor": {
    "id": 7,
    "name": "Plex",
    "url": "http://plex:32400/web",
    "type": "http"
  },
  "msg": "Plex is DOWN"
}
```

**UP event:**

```json
{
  "heartbeat": {
    "status": 1,
    "msg": "200 - OK",
    "time": "2024-06-01T12:05:00.000Z",
    "ping": 42,
    "duration": 300,
    "important": true
  },
  "monitor": {
    "id": 7,
    "name": "Plex",
    "url": "http://plex:32400/web",
    "type": "http"
  },
  "msg": "Plex is UP"
}
```

**Status mapping:**
- `0` (DOWN) → critical firing alert
- `1` (UP) → info resolved alert
- `2` (PENDING), `3` (MAINTENANCE) → ignored

**Dedup:** By `monitor.id` — a DOWN followed by an UP for the same monitor auto-resolves the incident.

## Docker Workspace Setup

The `workspacePath` setting points to a directory containing your Docker Compose files. The SRE plugin uses this to:

1. **Resolve service definitions** — maps container names to compose services
2. **Find dependency chains** — understands `depends_on` relationships
3. **Locate compose files** — for diagnostics and context

### Recommended Structure

```
/home/user/docker/
  docker-compose.yml         # Main compose file
  compose/
    media.yml                # Media services
    monitoring.yml           # Prometheus, Grafana, etc.
    networking.yml           # Reverse proxy, DNS, etc.
  .env                       # Docker environment variables
```

The plugin scans for `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`, and any `.yml`/`.yaml` files in subdirectories.

## Auto-Remediation Allowlist

The restart allowlist controls which containers the worker process is allowed to restart automatically. This is a safety mechanism to prevent accidental restarts of critical services.

### Configuration

The allowlist is configured per-incident through the remediation flow:

```typescript
{
  allowlist: ["nginx", "plex", "sonarr"],  // specific services
  // or
  allowlist: ["*"],                         // allow all (dangerous)
  cooldownMs: 300000,                       // 5 min between restarts per service
  requireApproval: true,                    // require Discord button approval
  alertChannelId: "123456789012345678"
}
```

### Behavior

1. **Allowlist check**: If the container name is not in the allowlist, the restart is denied.
2. **Cooldown check**: If the service was restarted within `cooldownMs`, the restart is denied.
3. **Approval check**: If `requireApproval` is true, a Discord approval button is posted and execution waits.
4. **Execute**: Container is restarted via Docker API with a 10-second grace period.
5. **Health verification**: Polls container health for up to 30 seconds after restart.
6. **Notify**: Result is posted to the alert channel and recorded in the incident timeline.

## Policy Engine

The policy engine evaluates rules before actions are executed. Rules are evaluated in order — the first deny or approval-required result stops evaluation.

### Rule Types

#### Allowlist

Only permit actions for listed services:

```json
{
  "type": "allowlist",
  "name": "restart-allowlist",
  "config": {
    "services": ["nginx", "plex", "sonarr", "radarr"],
    "actions": ["restart", "docker_restart"]
  }
}
```

#### Denylist

Block specific actions:

```json
{
  "type": "denylist",
  "name": "no-restart-databases",
  "config": {
    "services": ["postgres", "redis", "mariadb"],
    "actions": ["restart"]
  }
}
```

#### Cooldown

Prevent repeated actions within a time window:

```json
{
  "type": "cooldown",
  "name": "restart-cooldown",
  "config": {
    "actionPattern": "restart",
    "servicePattern": "*",
    "cooldownMs": 300000
  }
}
```

- `actionPattern`: Exact match or `"*"` for all actions
- `servicePattern`: Exact match or `"*"` for all services
- `cooldownMs`: Minimum time in milliseconds between actions

#### Rate Limit

Limit the number of actions in a rolling window:

```json
{
  "type": "rateLimit",
  "name": "restart-rate-limit",
  "config": {
    "actionPattern": "restart",
    "maxActions": 5,
    "windowMs": 3600000
  }
}
```

- `maxActions`: Maximum number of actions allowed per window
- `windowMs`: Window duration in milliseconds

#### Maintenance Window

Suppress or require approval during scheduled maintenance:

```json
{
  "type": "maintenanceWindow",
  "name": "weekly-maintenance",
  "config": {
    "dayOfWeek": [2],
    "startHour": 2,
    "endHour": 6,
    "timezone": "America/New_York",
    "suppressSeverities": ["info", "warning"]
  }
}
```

- `dayOfWeek`: Array of days (0=Sunday, 6=Saturday)
- `startHour` / `endHour`: UTC hours (0–23). Supports wrapping midnight (e.g., start=22, end=6).
- `timezone`: Display only — all evaluation uses UTC
- `suppressSeverities`: Alerts with these severities are fully suppressed (denied) during the window. Other severities require approval.

### Maintenance Window Examples

**Nightly maintenance (every day, 2–6 AM UTC):**

```json
{
  "type": "maintenanceWindow",
  "name": "nightly-maintenance",
  "config": {
    "dayOfWeek": [0, 1, 2, 3, 4, 5, 6],
    "startHour": 2,
    "endHour": 6,
    "suppressSeverities": ["info"]
  }
}
```

**Weekend maintenance (Saturday & Sunday, all day):**

```json
{
  "type": "maintenanceWindow",
  "name": "weekend-maintenance",
  "config": {
    "dayOfWeek": [0, 6],
    "startHour": 0,
    "endHour": 0,
    "suppressSeverities": ["info", "warning"]
  }
}
```

**Tuesday patch window (2–6 AM UTC):**

```json
{
  "type": "maintenanceWindow",
  "name": "tuesday-patches",
  "config": {
    "dayOfWeek": [2],
    "startHour": 2,
    "endHour": 6,
    "suppressSeverities": ["info", "warning"]
  }
}
```

## Incident Lifecycle

Incidents follow a state machine with these transitions:

```
open → acknowledged → investigating → resolved → closed
  │                                      ↑          │
  └──────────────────────────────────────┘          │
                                                     │
  open ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
```

| From | Allowed Transitions |
|------|---------------------|
| `open` | `acknowledged`, `investigating`, `resolved`, `closed` |
| `acknowledged` | `investigating`, `resolved`, `closed` |
| `investigating` | `resolved`, `closed` |
| `resolved` | `closed`, `open` (re-open) |
| `closed` | `open` (re-open) |

Each transition is recorded in the incident timeline with actor and timestamp.
