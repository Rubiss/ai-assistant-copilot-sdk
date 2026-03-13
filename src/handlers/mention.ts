import { Message, Client } from "discord.js";
import { SessionManager, truncateForDiscord } from "../copilot.js";

export async function handleMention(
  message: Message,
  client: Client,
  sessions: SessionManager
): Promise<void> {
  // Strip all @mentions of the bot and trim
  const botMentionPattern = new RegExp(`<@!?${client.user!.id}>`, "g");
  const prompt = message.content.replace(botMentionPattern, "").trim();

  if (!prompt) {
    await message.reply(
      "👋 Hi! Mention me with a question or command. Use `/ask` for one-shot queries, `/chat` for persistent conversation, or `/reset` to clear your history."
    );
    return;
  }

  try {
    // Show typing indicator while Copilot is thinking
    if ("sendTyping" in message.channel) {
      await message.channel.sendTyping();
    }
    const response = await sessions.sendMessage(message.author.id, prompt);
    await message.reply(truncateForDiscord(response));
  } catch (err) {
    console.error("[mention] Error:", err);
    await message.reply("❌ Something went wrong talking to Copilot. Please try again.");
  }
}
