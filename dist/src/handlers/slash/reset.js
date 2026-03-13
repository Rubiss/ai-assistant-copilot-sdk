export async function handleReset(interaction, sessions) {
    try {
        // Use thread ID as session key when inside a thread (matches /chat thread sessions)
        const sessionKey = interaction.channel?.isThread()
            ? interaction.channelId
            : interaction.user.id;
        const scope = interaction.channel?.isThread() ? "This thread's Copilot session" : "Your Copilot session";
        await sessions.resetSession(sessionKey);
        await interaction.reply({
            content: `✅ ${scope} has been reset.`,
            ephemeral: true,
        });
    }
    catch (err) {
        console.error("[/reset] Error:", err);
        await interaction.reply({
            content: "❌ Failed to reset session. Please try again.",
            ephemeral: true,
        });
    }
}
