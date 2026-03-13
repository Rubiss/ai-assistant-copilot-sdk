const MODE_DESCRIPTIONS = {
    interactive: "normal chat",
    plan: "structured planning",
    autopilot: "autonomous execution",
};
export async function handleMode(interaction, sessions) {
    const sub = interaction.options.getSubcommand(true);
    const sessionKey = interaction.channel?.isThread()
        ? interaction.channelId
        : interaction.user.id;
    try {
        if (sub === "get") {
            await interaction.deferReply({ ephemeral: true });
            const mode = await sessions.getMode(sessionKey);
            const desc = MODE_DESCRIPTIONS[mode] ?? mode;
            await interaction.editReply(`🎛 Current mode: \`${mode}\` — ${desc}`);
        }
        else if (sub === "set") {
            const mode = interaction.options.getString("mode", true);
            await interaction.deferReply({ ephemeral: true });
            await sessions.setMode(sessionKey, mode);
            await interaction.editReply(`✅ Session mode set to \`${mode}\`.`);
        }
    }
    catch (err) {
        console.error(`[/mode ${sub}] Error:`, err);
        const msg = `❌ Failed to ${sub === "get" ? "get" : "set"} mode. Please try again.`;
        if (interaction.deferred)
            await interaction.editReply(msg).catch(() => { });
        else
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => { });
    }
}
