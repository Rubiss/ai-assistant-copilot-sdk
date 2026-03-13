# AI Assistant

A personal Discord bot backed by the [GitHub Copilot SDK](https://github.com/github/copilot-sdk). Chat with Copilot directly from a Discord channel — with full tool access, persistent conversation history, slash commands, and thread-based isolated sessions.

## Features

- **Thread-based chat** — `/chat` spawns a dedicated Discord thread per conversation, each with its own isolated session context
- **Free-form chat** in a designated channel — no `@mention` required
- **Persistent session** per user/thread — conversation history maintained across messages
- **Full tool access** — Copilot can read files, run shell commands, search the web, etc.
- **User-scope skills** — automatically loads skills from `~/.agents/skills` at session start
- **Model switching** — change the Copilot model per-user at runtime
- **Slash commands** for quick actions and session management
- **User allowlist** — restrict access to specific Discord user IDs
- **Auto-restart** via systemd (WSL + Linux)

## Slash Commands

| Command | Description |
|---------|-------------|
| `/ask <prompt>` | One-shot question — no session history, result is private (ephemeral) |
| `/chat <message>` | Start a persistent conversation in a new thread (or continue in current thread/DM) |
| `/reset` | Clear your conversation history and start fresh |
| `/model list` | List all available Copilot models |
| `/model set <model_id>` | Switch your active Copilot model (takes effect on next message) |
| `/status` | Show Copilot auth status and CLI version |
| `/history [count]` | Show your last N conversation exchanges (default 5, max 20) |
| `/servers` | List all Discord servers this bot is installed in |
| `/leave <guild_id>` | Remove the bot from a server by ID |

### How `/chat` works

- **In a channel** — creates a new public thread named `Copilot: {your message}`. The session is isolated to that thread. Just type in the thread — no `@mention` needed.
- **Already in a thread** — continues the conversation in that thread's session.
- **In a DM** — responds inline; the whole DM is one persistent session.

## Setup

### 1. Prerequisites

- Node.js 18+
- A [Discord application](https://discord.com/developers/applications) with a bot user
- A GitHub account with Copilot access (the SDK authenticates via `gh` CLI)

### 2. Clone and install

```bash
git clone git@github.com:Rubiss/ai-assistant-copilot-sdk.git
cd ai-assistant
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=          # Bot token from Discord Developer Portal → Bot
DISCORD_APP_ID=         # Application ID from Discord Developer Portal → General Information
DISCORD_GUILD_ID=       # Your Discord server ID (for slash command registration)
DISCORD_FREE_CHANNELS=  # Optional: comma-separated channel IDs where bot replies without @mention
DISCORD_ALLOWED_USERS=  # Optional: comma-separated user IDs allowed to use the bot (all others ignored)
```

**Getting IDs**: Enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click any server/channel/user to copy its ID.

### 4. Invite the bot to your server

In the [Discord Developer Portal](https://discord.com/developers/applications), go to:
**OAuth2 → URL Generator** → select scopes: `bot` + `applications.commands`

Under Bot Permissions, select at minimum:
**Send Messages**, **Send Messages in Threads**, **Create Public Threads**, **Read Message History**, **Use Slash Commands**.

Copy the generated URL and open it in a browser to invite the bot to your server.

### 5. Register slash commands

```bash
npm run register
```

Run this once (and again whenever you add or change slash commands).

### 6. Start the bot

```bash
npm start
```

## Skills

The bot automatically loads user-scope skills from `~/.agents/skills` at session creation. Drop any `.yml` skill files there and they'll be available to Copilot in every conversation.

## Running as a Service (systemd / WSL)

If you're on WSL with systemd enabled (`/etc/wsl.conf` has `systemd=true`), you can run the bot as a system service that starts automatically when WSL boots.

> ⚠️ **Before installing**: `ai-assistant.service` contains a hardcoded username (`rubiss`) and absolute path (`/mnt/e/Projects/ai-assistant`). Edit these to match your system before running the install script:
>
> ```ini
> User=your-username
> WorkingDirectory=/path/to/ai-assistant
> ExecStart=/path/to/ai-assistant/node_modules/.bin/tsx src/index.ts
> EnvironmentFile=/path/to/ai-assistant/.env
> ```

Install the service (run once):

```bash
sudo bash scripts/install-service.sh
```

Useful commands after installation:

```bash
sudo systemctl status ai-assistant       # check if running
sudo systemctl restart ai-assistant      # restart after code changes
sudo journalctl -u ai-assistant -f       # live logs
sudo systemctl stop ai-assistant         # stop the bot
```

## Project Structure

```
src/
  index.ts              # Entry point — loads .env, starts bot
  bot.ts                # Discord client, command routing, message & thread handling
  copilot.ts            # SessionManager: Copilot SDK sessions, message queuing, model/skill loading
  commands.ts           # Slash command definitions and CommandName union type
  handlers/
    mention.ts          # Handles @mentions, free-channel messages, and bot-owned thread messages
    slash/
      ask.ts            # /ask handler (ephemeral, no history)
      chat.ts           # /chat handler (thread creation, DM fallback)
      reset.ts          # /reset handler
      model.ts          # /model list and /model set handlers
      status.ts         # /status handler
      history.ts        # /history handler
      servers.ts        # /servers handler
      leave.ts          # /leave handler
scripts/
  register-commands.ts  # One-time slash command registration
  install-service.sh    # systemd service installer
ai-assistant.service    # systemd unit file (edit before use — see above)
.env.example            # Environment variable template
```

## Security Notes

- The bot token and all credentials live only in `.env`, which is git-ignored and never committed.
- Use `DISCORD_ALLOWED_USERS` to restrict the bot to your own Discord user ID — especially important since the bot has full tool access to your machine.
- The bot uses `approveAll` permissions — it will execute any tool Copilot requests without prompting. Only expose it to users you trust completely.
- Thread sessions are isolated by thread ID, so different `/chat` conversations don't share context.
