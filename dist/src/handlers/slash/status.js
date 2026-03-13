export async function handleStatus(interaction, sessions) {
    try {
        await interaction.deferReply({ ephemeral: true });
        const { status, authStatus } = await sessions.getStatus();
        const authLine = authStatus.isAuthenticated
            ? `✅ Authenticated as **${authStatus.login ?? "unknown"}** via \`${authStatus.authType}\` on \`${authStatus.host ?? "github.com"}\``
            : `❌ Not authenticated — ${authStatus.statusMessage ?? "unknown reason"}`;
        await interaction.editReply(`**Copilot Status**\n${authLine}\nCLI version: \`${status.version}\``);
    }
    catch (err) {
        console.error("[/status] Error:", err);
        const msg = "❌ Failed to retrieve status. Please try again.";
        if (interaction.deferred) {
            await interaction.editReply(msg);
        }
        else {
            await interaction.reply({ content: msg, ephemeral: true });
        }
    }
}
