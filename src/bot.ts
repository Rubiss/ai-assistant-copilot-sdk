import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChatInputCommandInteraction,
} from "discord.js";
import { SessionManager } from "./copilot.js";
import { handleAsk } from "./handlers/slash/ask.js";
import { handleChat } from "./handlers/slash/chat.js";
import { handleReset } from "./handlers/slash/reset.js";
import { handleServers } from "./handlers/slash/servers.js";
import { handleLeave } from "./handlers/slash/leave.js";
import { handleModel } from "./handlers/slash/model.js";
import { handleStatus } from "./handlers/slash/status.js";
import { handleHistory } from "./handlers/slash/history.js";
import { handleAgent } from "./handlers/slash/agent.js";
import { handleMode } from "./handlers/slash/mode.js";
import { handleCompact } from "./handlers/slash/compact.js";
import { handleFleet } from "./handlers/slash/fleet.js";
import { handlePlan } from "./handlers/slash/plan.js";
import { handleWorkspace } from "./handlers/slash/workspace.js";
import { handleMention } from "./handlers/mention.js";

// If DISCORD_ALLOWED_USERS is set, only these Discord user IDs can use the bot.
// NOTE: computed inside createBot() so dotenv.config() has already run in index.ts.

export function createBot(sessions: SessionManager): Client {
  const allowedUsers = new Set(
    (process.env.DISCORD_ALLOWED_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  const isAllowed = (userId: string): boolean =>
    allowedUsers.size === 0 || allowedUsers.has(userId);

  // Channel ID(s) where the bot responds to every message without needing a mention
  const freeChannels = new Set(
    (process.env.DISCORD_FREE_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel], // Required for DM support
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`✅ Discord bot ready as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (!isAllowed(interaction.user.id)) {
      await interaction.reply({ content: "⛔ You are not authorized to use this bot.", ephemeral: true });
      return;
    }

    const cmd = interaction as ChatInputCommandInteraction;
    switch (cmd.commandName) {
      case "ask":
        await handleAsk(cmd, sessions);
        break;
      case "chat":
        await handleChat(cmd, sessions);
        break;
      case "reset":
        await handleReset(cmd, sessions);
        break;
      case "servers":
        await handleServers(cmd, client);
        break;
      case "leave":
        await handleLeave(cmd, client);
        break;
      case "model":
        await handleModel(cmd, sessions);
        break;
      case "status":
        await handleStatus(cmd, sessions);
        break;
      case "history":
        await handleHistory(cmd, sessions);
        break;
      case "agent":
        await handleAgent(cmd, sessions);
        break;
      case "mode":
        await handleMode(cmd, sessions);
        break;
      case "compact":
        await handleCompact(cmd, sessions);
        break;
      case "fleet":
        await handleFleet(cmd, sessions);
        break;
      case "plan":
        await handlePlan(cmd, sessions);
        break;
      case "workspace":
        await handleWorkspace(cmd, sessions);
        break;
      default:
        console.warn(`Unknown command: ${cmd.commandName}`);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!client.user) return;
    if (!isAllowed(message.author.id)) return;

    // Bot-owned threads: respond to every message, session keyed by thread ID
    if (message.channel.isThread() && message.channel.ownerId === client.user.id) {
      await handleMention(message, client, sessions, message.channelId);
      return;
    }

    const isMentioned = message.mentions.has(client.user.id);
    const isFreeChannel = freeChannels.has(message.channelId);

    if (!isMentioned && !isFreeChannel) return;

    await handleMention(message, client, sessions);
  });

  return client;
}
