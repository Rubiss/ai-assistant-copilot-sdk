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
import { handleMention } from "./handlers/mention.js";

export function createBot(sessions: SessionManager): Client {
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
      default:
        console.warn(`Unknown command: ${cmd.commandName}`);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    // Ignore bots and messages that don't mention us
    if (message.author.bot) return;
    if (!client.user) return;
    if (!message.mentions.has(client.user.id)) return;

    await handleMention(message, client, sessions);
  });

  return client;
}
