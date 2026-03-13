export async function handleCompact(interaction, sessions) {
    const sessionKey = interaction.channel?.isThread()
        ? interaction.channelId
        : interaction.user.id;
    try {
        await interaction.deferReply({ ephemeral: true });
        const result = await sessions.compact(sessionKey);
        if (result.success) {
            await interaction.editReply(`✅ Compacted: removed **${result.tokensRemoved}** tokens and **${result.messagesRemoved}** messages.`);
        }
        else {
            await interaction.editReply("⚠️ Compaction completed but reported failure.");
        }
    }
    catch (err) {
        console.error("[/compact] Error:", err);
        const msg = "❌ Failed to compact session. Please try again.";
        if (interaction.deferred)
            await interaction.editReply(msg).catch(() => { });
        else
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => { });
    }
}
