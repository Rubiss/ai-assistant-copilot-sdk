# Discord Bot Setup: Comprehensive Developer Guide

**Source**: [docs.discord.com/developers/quick-start/getting-started](https://docs.discord.com/developers/quick-start/getting-started) and related pages  
**Researched**: 2026-03-13

---

## Executive Summary

Discord's developer platform lets you build bots, Activities (embedded web apps), and Social SDK integrations. Every integration starts with an **Application** registered in the [Developer Portal](https://discord.com/developers/applications). Bots are the most common pattern: automated user accounts that respond to slash commands, button clicks, and real-time events. The official getting-started guide walks through building a JavaScript/Express bot that handles slash commands and message components, using either HTTP webhooks or a WebSocket Gateway connection to receive interaction events. This report covers the full setup flow end-to-end — from portal configuration to production deployment considerations.[^1]

---

## Architecture Overview

```
┌─────────────────────────────────────┐
│         Discord Developer Portal    │
│  ┌───────────────────────────────┐  │
│  │  Application (App ID + Keys)  │  │
│  │  ├── Bot User (token)         │  │
│  │  ├── OAuth2 Config            │  │
│  │  ├── Install Link / Scopes    │  │
│  │  └── Interactions Endpoint    │  │
│  └───────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │ slash commands / components
               ▼
┌─────────────────────────────────────┐
│         Your Bot Server             │
│  ┌───────────────────────────────┐  │
│  │  Express / HTTP server        │  │──── HTTP API ────▶ Discord REST
│  │  POST /interactions           │  │                   (messages, etc.)
│  │  Validates signature          │  │
│  │  Routes by type + custom_id   │  │
│  └───────────────────────────────┘  │
└──────────────────────────────────────┘
         ── OR ──
┌─────────────────────────────────────┐
│         Gateway WebSocket           │
│  Connect → Identify → Heartbeat     │
│  Receive real-time events           │
└──────────────────────────────────────┘
```

**Two API surfaces:**[^2]
- **HTTP API** — REST, for sending/updating/fetching resources
- **Gateway API** — WebSocket, for real-time event streaming

**Two interaction models** (mutually exclusive):[^3]
- **Gateway**: WebSocket-based; app connects and Discord pushes events
- **HTTP Interactions Endpoint URL**: Discord POSTs to your public endpoint on each interaction

---

## Step 1 — Create an Application in the Developer Portal

1. Navigate to [discord.com/developers/applications](https://discord.com/developers/applications) and click **New Application** (or use the direct link: [Create App](https://discord.com/developers/applications?new_application=true))
2. Enter a name and click **Create**
3. You land on the **General Information** page — note:
   - **Application ID** — used in all API calls
   - **Public Key** — used to verify incoming HTTP interaction signatures
   - **Interactions Endpoint URL** field — where Discord will POST interactions (Step 4)

### Credentials to collect[^1]

| Credential | Where to find it | Used for |
|---|---|---|
| Application ID | General Information page | API calls, `.env` as `APP_ID` |
| Public Key | General Information page | Validating HTTP interaction signatures |
| Bot Token | Bot page → "Reset Token" | Authenticating HTTP API calls as your bot |

> ⚠️ **Bot tokens are secrets.** Never commit them to source control. Store in `.env` and add `.env` to `.gitignore`.

---

## Step 2 — Configure the Bot User

On the **Bot** page in your app's settings:[^1]

- **Token**: Click "Reset Token" to generate. Store it as `BOT_TOKEN` in `.env`.
- **Public Bot**: Toggle whether other users can add your bot to their servers.
- **Privileged Intents**: Opt-in to sensitive event groups (see Intents section below).

### Gateway Intents

Intents are bitwise flags that tell Discord which events your bot wants to receive over a Gateway connection.[^4] They are set when sending the `IDENTIFY` payload (opcode `2`).

**Standard intents** (no approval needed) — examples:
- `GUILD_MESSAGE_REACTIONS` (`1 << 10`) — reaction events
- `GUILD_MEMBERS` — member join/leave events

**Privileged intents** (must be enabled on Bot page + approved before verification):
- `MESSAGE_CONTENT` — read the actual text of messages
- `GUILD_PRESENCES` — user presence (online/offline/activity) data
- `GUILD_MEMBERS` — full member list access

For the HTTP interaction model used in the quick-start guide, **no Gateway intents are needed** since the bot responds to interactions only (no passive event listening).[^1]

---

## Step 3 — Configure Installation Contexts

**Installation contexts** determine where your app can be installed:[^1]

| Context | How installed | Who sees it | Permissions required |
|---|---|---|---|
| **Guild Install** (server) | User with `MANAGE_GUILD` authorizes | All server members | Server-specific bot permissions |
| **User Install** | Any user authorizes for themselves | Only that user | None (DMs, GDMs, any server) |

**To configure**: Go to **Installation** in the left sidebar → check both "User Install" and "Guild Install" under **Installation Contexts**.

---

## Step 4 — Set Up OAuth2 Scopes and Bot Permissions

Apps need OAuth2 scopes granted by the installing user. Set these in **Installation → Default Install Settings**.[^5]

### Required Scopes

| Scope | Install Context | What it does |
|---|---|---|
| `applications.commands` | User Install + Guild Install | Allows registering slash commands |
| `bot` | Guild Install only | Adds the bot user to the server |

When `bot` scope is selected, a **Permissions** selector appears. Common permissions:

- `Send Messages` — required to respond in channels
- `Read Message History`
- `Embed Links`
- `Use Slash Commands`

> **Note**: Apps installed to user context can only use commands — bot permissions only apply to guild installs.[^1]

---

## Step 5 — Install Your App

### Via Discord Provided Install Link[^1]

1. On **Installation** page, select **Discord Provided Link** in the Install Link section.
2. Copy the generated URL.
3. **For server install**: Paste URL in browser → "Add to server" → select your test server.
4. **For user install**: Paste the same URL → "Add to my apps".

After server install, the bot appears in the server member list.

### Manual OAuth2 URL (alternative)

```
https://discord.com/oauth2/authorize
  ?client_id=YOUR_APP_ID
  &scope=applications.commands%20bot
  &permissions=2048
  &response_type=code
  &redirect_uri=YOUR_REDIRECT
  &integration_type=0
```

`integration_type=0` = guild install, `integration_type=1` = user install.[^5]

---

## Step 6 — Register Slash Commands

Commands must be registered via the HTTP API before they appear in the Discord client.[^6]

### Global Commands (production)

Available in all guilds. Updates can take up to 1 hour to propagate.[^6]

```python
# Python example
import requests

url = f"https://discord.com/api/v10/applications/{APP_ID}/commands"
headers = {"Authorization": f"Bot {BOT_TOKEN}"}
json = {
    "name": "blep",
    "type": 1,  # CHAT_INPUT (slash command)
    "description": "Send a random adorable animal photo",
    "options": [
        {
            "name": "animal",
            "description": "The type of animal",
            "type": 3,  # STRING
            "required": True,
            "choices": [
                {"name": "Dog", "value": "animal_dog"},
                {"name": "Cat", "value": "animal_cat"}
            ]
        }
    ]
}
r = requests.post(url, headers=headers, json=json)
```

### Guild Commands (development/testing)

Scoped to a specific server. **Instant** updates — use these during development.[^6]

```
POST https://discord.com/api/v10/applications/{APP_ID}/guilds/{GUILD_ID}/commands
```

### Bulk Overwrite (recommended for multi-command apps)[^1]

```
PUT https://discord.com/api/v10/applications/{APP_ID}/commands
```

This replaces all global commands atomically. The sample app's `npm run register` script uses this endpoint.

### Command Limits[^6]

| Type | Max Global | Max Per Guild |
|---|---|---|
| `CHAT_INPUT` (slash) | 100 | 100 |
| `USER` (context menu) | 15 | 15 |
| `MESSAGE` (context menu) | 15 | 15 |

### Command Types[^6]

| Name | Value | Access |
|---|---|---|
| `CHAT_INPUT` | 1 | Typing `/` in chat |
| `USER` | 2 | Right-click a user → Apps |
| `MESSAGE` | 3 | Right-click a message → Apps |
| `PRIMARY_ENTRY_POINT` | 4 | App Launcher (for Activities) |

---

## Step 7 — Handle Interactions

When users invoke a command or click a component, Discord sends an **Interaction** payload.[^3]

### Two delivery methods (mutually exclusive)[^3]

**Option A: HTTP Interactions Endpoint** (recommended for stateless apps)
- Set **Interactions Endpoint URL** on General Information page
- Discord POSTs all interactions to your URL
- Your server must respond within **3 seconds** or the interaction times out

**Option B: Gateway WebSocket**
- Default if no Interactions Endpoint URL is set
- See Gateway section below for connection lifecycle

### Setting Up an HTTP Interactions Endpoint

Before Discord accepts your URL, your server must:[^3]

1. **Acknowledge PING** — respond to `type: 1` with `{"type": 1}` and HTTP 200
2. **Validate signatures** — check `X-Signature-Ed25519` and `X-Signature-Timestamp` headers on every request

```javascript
// Express + discord-interactions example
import { verifyKeyMiddleware, InteractionType, InteractionResponseType } from 'discord-interactions';

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), (req, res) => {
  const { type, data } = req.body;

  // Handle PING (step 1 — portal verification)
  if (type === InteractionType.PING) {
    return res.send({ type: 1 });
  }

  // Handle slash commands
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;
    if (name === 'test') {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Hello world! 👋' }
      });
    }
  }
});
```

For local development, use **ngrok** to expose your local server:[^1]

```bash
ngrok http 3000
# → https://1234-someurl.ngrok.io → localhost:3000
# Paste https://1234-someurl.ngrok.io/interactions as your Interactions Endpoint URL
```

### Interaction Types[^7]

| Name | Value | When triggered |
|---|---|---|
| `PING` | 1 | Portal verification only |
| `APPLICATION_COMMAND` | 2 | Slash/user/message command invoked |
| `MESSAGE_COMPONENT` | 3 | Button clicked, select menu used |
| `APPLICATION_COMMAND_AUTOCOMPLETE` | 4 | User typing in autocomplete-enabled option |
| `MODAL_SUBMIT` | 5 | User submitted a modal form |

### Interaction Response Types[^7]

| Type | Value | Use |
|---|---|---|
| `PONG` | 1 | Respond to PING |
| `CHANNEL_MESSAGE_WITH_SOURCE` | 4 | Send a message in the channel |
| `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` | 5 | Acknowledge, send message later (async) |
| `DEFERRED_UPDATE_MESSAGE` | 6 | Acknowledge component, update later |
| `UPDATE_MESSAGE` | 7 | Update the message the component is attached to |
| `APPLICATION_COMMAND_AUTOCOMPLETE_RESULT` | 8 | Return autocomplete choices |
| `MODAL` | 9 | Open a popup form |

---

## Step 8 — Message Components

Message components are interactive UI elements sent in messages.[^3]

### Component Types

| Type | Value | Description |
|---|---|---|
| Action Row | 1 | Container for other components (required wrapper) |
| Button | 2 | Clickable button (5 styles) |
| String Select | 3 | Dropdown with developer-defined options |
| Text Input | 4 | Single/multi-line form field (modals only) |
| User Select | 5 | Auto-populated dropdown of server users |
| Role Select | 6 | Auto-populated dropdown of server roles |
| Mentionable Select | 7 | Users + roles combined |
| Channel Select | 8 | Auto-populated dropdown of channels |

### Sending a Button

```javascript
return res.send({
  type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
  data: {
    content: 'Click the button!',
    components: [
      {
        type: 1, // ACTION_ROW
        components: [
          {
            type: 2,        // BUTTON
            custom_id: 'my_button_12345',  // unique identifier
            label: 'Accept',
            style: 1        // PRIMARY (blue)
          }
        ]
      }
    ]
  }
});
```

### Handling a Button Click

Route by `type === MESSAGE_COMPONENT` and match `custom_id`:[^1]

```javascript
if (type === InteractionType.MESSAGE_COMPONENT) {
  const { custom_id } = data;
  if (custom_id.startsWith('my_button_')) {
    const gameId = custom_id.replace('my_button_', '');
    // respond with ephemeral message (flags: 64)
    return res.send({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: 64,  // EPHEMERAL — only visible to the clicker
        content: `You clicked button for game ${gameId}!`
      }
    });
  }
}
```

> **Key pattern**: Encode state in `custom_id` (e.g., `accept_button_{gameId}`) since Discord doesn't maintain server-side component state.[^1]

---

## Gateway API (Alternative to HTTP Interactions)

Use the Gateway when you need real-time event streaming beyond just interactions — e.g., monitoring all messages, tracking voice state, or server member events.[^4]

### Connection Lifecycle

```
1. GET /gateway/bot → get WSS URL + session start limits
2. Connect to wss://gateway.discord.gg/?v=10&encoding=json
3. Receive Hello (op:10) → get heartbeat_interval
4. Start heartbeat loop (send op:1 every heartbeat_interval ms)
5. Send Identify (op:2) → include token + intents bitmask
6. Receive Ready (op:0, t:"READY") → connection established ✓
7. Receive Dispatch events (op:0) for subscribed intents
8. On disconnect: check close code → Resume or full re-Identify
```

### Identify Payload Example[^4]

```json
{
  "op": 2,
  "d": {
    "token": "Bot MY_BOT_TOKEN",
    "intents": 513,
    "properties": {
      "os": "linux",
      "browser": "my_library",
      "device": "my_library"
    }
  }
}
```

`intents: 513` = `GUILDS (1 << 0) | GUILD_MESSAGES (1 << 9)`

### Heartbeating[^4]

```json
// Send every heartbeat_interval ms (typically ~45 seconds)
{ "op": 1, "d": LAST_SEQUENCE_NUMBER }

// Discord ACK response
{ "op": 11 }
```

If you don't receive a heartbeat ACK, close the connection (non-1000/1001 code) and attempt to Resume.

### Resuming vs. Re-Identifying[^4]

- Cache `resume_gateway_url` from the Ready event
- On disconnect with certain close codes, send a **Resume** (op:6) with your `session_id` and last `s` value
- On `4000`, `4007`, `4009` close codes → must re-Identify (new session)

---

## Authentication & API Calls

### Bot Token (primary method)[^8]

```
Authorization: Bot YOUR_BOT_TOKEN
```

Use for all HTTP API calls made by your bot.

### OAuth2 Bearer Token[^8]

```
Authorization: Bearer OAUTH2_ACCESS_TOKEN
```

Use for user-delegated actions (acting on behalf of a user who authorized your app).

### API Base URL

```
https://discord.com/api/v10
```

Current stable version: **v10**. v9 is still available; v8 and below deprecated.[^8]

### Rate Limiting[^8]

- Discord implements per-route rate limits per RFC 6585
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Global limit: 50 requests/second
- Apps that repeatedly hit and ignore rate limits have their keys revoked

---

## Project Structure (Official Example App)

The official [discord/discord-example-app](https://github.com/discord/discord-example-app) repository follows this structure:[^1]

```
discord-example-app/
├── .env                 # APP_ID, PUBLIC_KEY, BOT_TOKEN
├── app.js               # Main Express server — interaction handler
├── commands.js          # Slash command definitions + ALL_COMMANDS array
├── game.js              # Rock-paper-scissors logic
├── utils.js             # DiscordRequest helper, getRandomEmoji, etc.
├── package.json
└── examples/
    ├── app.js           # Complete finished app code
    ├── button.js        # Button-only example
    ├── command.js       # Command-only example
    ├── modal.js         # Modal example
    └── selectMenu.js    # Select menu example
```

### Environment Variables (`.env`)

```bash
APP_ID=YOUR_APPLICATION_ID
PUBLIC_KEY=YOUR_PUBLIC_KEY
BOT_TOKEN=YOUR_BOT_TOKEN
```

### Quick Start Commands

```bash
git clone https://github.com/discord/discord-example-app.git
cd discord-example-app
npm install
cp .env.sample .env
# (fill in .env with your credentials)
npm run register   # registers slash commands globally
npm run start      # starts Express on port 3000
# in another terminal:
ngrok http 3000    # exposes localhost to internet
```

---

## OAuth2 Flows Summary

| Flow | Use case |
|---|---|
| **Authorization Code** | Authenticate users (standard OAuth2) |
| **Client Credentials** | Server-to-server, no user required |
| **Bot** | Add bot to guilds via install link |
| **Implicit** | SPAs / client-side only (no secret) |

### Key OAuth2 Scopes for Bots[^5]

| Scope | Purpose |
|---|---|
| `bot` | Adds bot user to guild |
| `applications.commands` | Register slash commands in guild |
| `identify` | Read basic user info |
| `guilds` | List user's guilds |
| `guilds.join` | Add user to a guild |
| `email` | Read user's email address |
| `connections` | See linked third-party accounts |
| `messages.read` | Read messages (local RPC only) |
| `webhook.incoming` | Generate a webhook URL |

---

## Common Pitfalls

| Problem | Cause | Fix |
|---|---|---|
| Interactions Endpoint URL not verified | Missing PING handler or signature validation | Implement both; use `discord-interactions` lib |
| Slash commands not appearing | Not registered, or app not installed with `applications.commands` scope | Run `PUT /applications/{id}/commands`; reinstall with correct scopes |
| Global command updates slow | Global commands cache up to 1 hour | Use guild commands during dev (`PUT /guilds/{id}/commands`) |
| 401 on API calls | Wrong auth header format | Use `Authorization: Bot TOKEN` (not Bearer) |
| Interaction timeout | Response not sent within 3 seconds | Use `DEFERRED_*` response type, then follow up |
| Button state lost on restart | `custom_id` matched but `activeGames` map cleared | Use persistent storage (database) for game/session state |
| `member` vs `user` field missing | Context matters: server = `member.user.id`; DM = `user.id` | Check `req.body.context === 0` for guild context |

---

## Key Reference Links

| Resource | URL |
|---|---|
| Developer Portal | https://discord.com/developers/applications |
| Quick Start Guide | https://docs.discord.com/developers/quick-start/getting-started |
| Apps Overview | https://docs.discord.com/developers/quick-start/overview-of-apps |
| Application Commands | https://docs.discord.com/developers/interactions/application-commands |
| Interactions Overview | https://docs.discord.com/developers/interactions/overview |
| Receiving & Responding | https://docs.discord.com/developers/interactions/receiving-and-responding |
| Gateway Documentation | https://docs.discord.com/developers/events/gateway |
| OAuth2 | https://docs.discord.com/developers/topics/oauth2 |
| API Reference | https://docs.discord.com/developers/reference |
| Message Components | https://docs.discord.com/developers/components/reference |
| Example App Repo | https://github.com/discord/discord-example-app |
| discord-interactions-js | https://github.com/discord/discord-interactions-js |
| Community Libraries | https://docs.discord.com/developers/developer-tools/community-resources |

---

## Confidence Assessment

**High confidence** (directly cited from official Discord docs):
- Application creation and portal configuration flow
- Credential names and locations (App ID, Public Key, Bot Token)
- Installation contexts and OAuth2 scopes
- Command registration endpoints and limits
- Interaction types and response types
- Security requirements for HTTP interactions endpoint (PING + signature validation)
- Gateway connection lifecycle (opcodes, heartbeat, Identify, Ready)
- API versioning (v10 current), auth header format

**Medium confidence** (from example app code — may vary by bot framework):
- Specific code patterns in `app.js` (correct for the `discord-interactions-js` library, may differ with other libraries like `discord.js`)
- The `ngrok` workflow is a common pattern but specific to the sample app approach

**Assumptions made**:
- Report targets the JavaScript/Node.js path from the official guide; Python, Go, etc. have equivalent patterns but different libraries
- The HTTP interactions model is the recommended pattern for most bots; Gateway is for event-heavy bots

---

## Footnotes

[^1]: [Discord Getting Started Guide](https://docs.discord.com/developers/quick-start/getting-started) — Steps 0–4, full project setup walkthrough
[^2]: [Discord Apps Overview](https://docs.discord.com/developers/quick-start/overview-of-apps) — "What APIs Can Apps Use?" section
[^3]: [Interactions Overview](https://docs.discord.com/developers/interactions/overview) — "Preparing for Interactions" and "Types of Interactions" sections
[^4]: [Gateway API Documentation](https://docs.discord.com/developers/events/gateway) — "Connection Lifecycle", "Identifying", "Sending Heartbeats" sections
[^5]: [OAuth2 Documentation](https://docs.discord.com/developers/topics/oauth2) — OAuth2 Scopes table, Authorization URL example
[^6]: [Application Commands Documentation](https://docs.discord.com/developers/interactions/application-commands) — Command types, registration, limits sections
[^7]: [Receiving and Responding Documentation](https://docs.discord.com/developers/interactions/receiving-and-responding) — Interaction structure, type enums, response types
[^8]: [API Reference](https://docs.discord.com/developers/reference) — Authentication, API versioning, rate limiting sections
