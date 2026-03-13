import { truncateForDiscord } from "../../copilot.js";
export async function handleHistory(interaction, sessions) {
    try {
        await interaction.deferReply({ ephemeral: true });
        // Use thread ID as session key when inside a thread (matches /chat thread sessions)
        const sessionKey = interaction.channel?.isThread()
            ? interaction.channelId
            : interaction.user.id;
        const events = await sessions.getHistory(sessionKey);
        if (!events) {
            await interaction.editReply("No active session. Start chatting first with `/chat`.");
            return;
        }
        const count = interaction.options.getInteger("count") ?? 5;
        // Extract only user and top-level assistant messages (skip sub-agent turns)
        const exchanges = events.filter((e) => (e.type === "user.message" || e.type === "assistant.message") &&
            !(e.type === "assistant.message" && e.data.parentToolCallId));
        const recent = exchanges.slice(-(count * 2)); // 2 events per exchange
        if (recent.length === 0) {
            await interaction.editReply("No messages in your session yet.");
            return;
        }
        const lines = recent.map((e) => {
            if (e.type === "user.message") {
                return `**You:** ${e.data.content}`;
            }
            else {
                // assistant.message
                const content = e.data.content;
                return `**Copilot:** ${content}`;
            }
        });
        await interaction.editReply(truncateForDiscord(lines.join("\n\n")));
    }
    catch (err) {
        console.error("[/history] Error:", err);
        const msg = "❌ Failed to retrieve history. Please try again.";
        if (interaction.deferred) {
            await interaction.editReply(msg);
        }
        else {
            await interaction.reply({ content: msg, ephemeral: true });
        }
    }
}
