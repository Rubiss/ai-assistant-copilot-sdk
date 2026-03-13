import { truncateForDiscord } from "../copilot.js";
export async function handleMention(message, client, sessions, sessionKey // defaults to message.author.id; pass channelId for thread sessions
) {
    // Strip all @mentions of the bot and trim
    const botMentionPattern = new RegExp(`<@!?${client.user.id}>`, "g");
    const prompt = message.content.replace(botMentionPattern, "").trim();
    if (!prompt) {
        await message.reply("👋 Hi! Mention me with a question or command. Use `/ask` for one-shot queries, `/chat` for persistent conversation, or `/reset` to clear your history.");
        return;
    }
    const key = sessionKey ?? message.author.id;
    try {
        // Keep typing indicator alive every 8s (Discord clears it after ~10s)
        let typingInterval;
        if ("sendTyping" in message.channel) {
            await message.channel.sendTyping();
            typingInterval = setInterval(() => {
                if ("sendTyping" in message.channel) {
                    message.channel.sendTyping().catch(() => { });
                }
            }, 8000);
        }
        let response;
        try {
            response = await sessions.sendMessage(key, prompt);
        }
        finally {
            clearInterval(typingInterval);
        }
        await message.reply(truncateForDiscord(response));
    }
    catch (err) {
        console.error("[mention] Error:", err);
        await message.reply("❌ Something went wrong talking to Copilot. Please try again.");
    }
}
