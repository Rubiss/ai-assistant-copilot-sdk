export async function handleFleet(interaction, sessions) {
    const sessionKey = interaction.channel?.isThread()
        ? interaction.channelId
        : interaction.user.id;
    try {
        await interaction.deferReply({ ephemeral: true });
        const prompt = interaction.options.getString("prompt") ?? undefined;
        const started = await sessions.startFleet(sessionKey, prompt);
        if (started) {
            await interaction.editReply(`🚀 Fleet mode started${prompt ? ` with prompt: "${prompt}"` : ""}.`);
        }
        else {
            await interaction.editReply("⚠️ Fleet mode could not be started.");
        }
    }
    catch (err) {
        console.error("[/fleet] Error:", err);
        const msg = "❌ Failed to start fleet mode. Please try again.";
        if (interaction.deferred)
            await interaction.editReply(msg).catch(() => { });
        else
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => { });
    }
}
