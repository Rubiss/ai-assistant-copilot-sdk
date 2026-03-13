import { truncateForDiscord } from "../../copilot.js";
export async function handleServers(interaction, client) {
    try {
        await interaction.deferReply({ ephemeral: true });
        const guilds = client.guilds.cache;
        if (guilds.size === 0) {
            await interaction.editReply("ℹ️ This bot is not installed in any servers.");
            return;
        }
        const lines = guilds.map((g) => `• **${g.name}** — ID: \`${g.id}\` (${g.memberCount ?? "?"} members)`);
        const body = `**Servers this bot is installed in (${guilds.size}):**\n${lines.join("\n")}`;
        await interaction.editReply(truncateForDiscord(body));
    }
    catch (err) {
        console.error("[/servers] Error:", err);
        const msg = "❌ Failed to list servers. Please try again.";
        if (interaction.deferred) {
            await interaction.editReply(msg).catch(() => { });
        }
        else {
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => { });
        }
    }
}
