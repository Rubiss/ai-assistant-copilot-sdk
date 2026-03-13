export async function handleLeave(interaction, client) {
    const guildId = interaction.options.getString("guild_id", true).trim();
    try {
        await interaction.deferReply({ ephemeral: true });
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            await interaction.editReply(`❌ No server found with ID \`${guildId}\`. Use \`/servers\` to see all installed servers.`);
            return;
        }
        const guildName = guild.name;
        await guild.leave();
        await interaction.editReply(`✅ Left server **${guildName}** (\`${guildId}\`).`);
    }
    catch (err) {
        console.error(`[/leave] Error:`, err);
        const msg = "❌ Failed to leave the server. Check bot permissions and try again.";
        if (interaction.deferred) {
            await interaction.editReply(msg).catch(() => { });
        }
        else {
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => { });
        }
    }
}
