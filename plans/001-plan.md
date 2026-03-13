# AI Assistant Discord Bot — Implementation Plan

## Problem

Build a Discord bot backed by the GitHub Copilot SDK that allows users to chat with an AI assistant from Discord — both via slash commands and by @mentioning the bot in any channel.

## Choices Made

| Decision | Choice | Rationale |
|---|---|---|
| Language | TypeScript / Node.js | Official SDK, best type support |
| Discord model | Gateway WebSocket (discord.js) | Required for free-form @mention chat |
| Interaction | Slash commands + @mention chat | Both UX modes requested |
| LLM auth | GitHub OAuth (existing Copilot sub) | No extra API key needed |

## Architecture

```
Discord Gateway
     │
     ▼
discord.js Client
     ├── interactionCreate → SlashCommandHandler
     │       ├── /ask <prompt>   — one-shot query, no history
     │       ├── /chat           — start/resume a persistent session thread
     │       └── /reset          — clear your session
     │
     └── messageCreate → MentionHandler
             └── @BotName <message>  — continues session for that user
                  │
                  ▼
             SessionManager
             ├── Per-user CopilotSession (lazy init, cached in memory)
             └── Persisted at ~/.copilot/session-state/{userId}/
                  │
                  ▼
             @github/copilot-sdk CopilotClient
                  │
                  ▼
             GitHub Copilot API (GitHub OAuth)
```

## File Structure

```
/mnt/e/Projects/ai-assistant/
├── src/
│   ├── index.ts              # Entry point: boot Discord client + Copilot client
│   ├── bot.ts                # Discord Gateway setup, event wiring
│   ├── copilot.ts            # SessionManager: create/cache/destroy CopilotSessions
│   ├── handlers/
│   │   ├── mention.ts        # messageCreate: respond to @mentions
│   │   └── slash/
│   │       ├── ask.ts        # /ask — ephemeral one-shot query
│   │       ├── chat.ts       # /chat — start/resume session thread
│   │       └── reset.ts      # /reset — clear user session
│   └── commands.ts           # Slash command definitions (name, description, options)
├── scripts/
│   └── register-commands.ts  # One-time: registers guild slash commands via REST
├── .env.example              # Template: DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID
├── package.json
└── tsconfig.json
```

## Todos

1. **project-init** — Init package.json with deps: `discord.js`, `@github/copilot-sdk`, `dotenv`, `typescript`, `tsx`, `@types/node`
2. **tsconfig** — Create tsconfig.json (ESM, target ES2022, strict)
3. **env-template** — Create .env.example with DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID
4. **copilot-session-manager** — `src/copilot.ts`: lazy-init per-user CopilotSession, cache in a Map, expose `sendMessage(userId, prompt)` and `resetSession(userId)`
5. **slash-commands-def** — `src/commands.ts`: define /ask, /chat, /reset command schemas for registration
6. **handler-ask** — `src/handlers/slash/ask.ts`: defer interaction → call copilot with ephemeral session → edit reply with result
7. **handler-chat** — `src/handlers/slash/chat.ts`: defer → use persistent session → reply in thread
8. **handler-reset** — `src/handlers/slash/reset.ts`: destroy session → confirm to user
9. **handler-mention** — `src/handlers/mention.ts`: filter messageCreate for @mentions → route to persistent session
10. **bot-setup** — `src/bot.ts`: create Discord.js Client with Gateway intents, register interaction/message handlers
11. **entry-point** — `src/index.ts`: load .env, start CopilotClient, start Discord bot, handle shutdown
12. **register-script** — `scripts/register-commands.ts`: register slash commands to guild via Discord REST API
13. **gitignore** — Add .gitignore: `.env`, `node_modules/`, `dist/`

## Dependencies

- `discord.js` ^14 — Gateway WebSocket, interactions
- `@github/copilot-sdk` — CopilotClient + CopilotSession
- `dotenv` — .env loading
- `tsx` — run TypeScript directly (dev)
- `typescript` — compiler
- `@types/node` — Node types
- `@discordjs/rest` — REST API for command registration (bundled with discord.js)

## Key Implementation Notes

- **Copilot auth**: GitHub OAuth will use `gh` CLI stored token (auto-discovered by SDK)
- **Session per user**: userId (Discord snowflake) used as session key; sessions cached in memory during runtime
- **Deferred replies**: Discord requires response within 3s; use `deferReply()` then `editReply()` for Copilot's async responses
- **MESSAGE_CONTENT intent**: Required (privileged) to read message text; must be enabled in Discord Developer Portal → Bot page
- **Guild commands**: Registered to a specific `DISCORD_GUILD_ID` for instant propagation during development
- **Graceful shutdown**: On SIGINT/SIGTERM, disconnect all CopilotSessions and stop the Discord client
