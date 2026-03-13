import { truncateForDiscord } from "../../copilot.js";
export async function handleAgent(interaction, sessions) {
    const sub = interaction.options.getSubcommand(true);
    const sessionKey = interaction.channel?.isThread()
        ? interaction.channelId
        : interaction.user.id;
    try {
        if (sub === "list") {
            await interaction.deferReply({ ephemeral: true });
            const agents = await sessions.listAgents(sessionKey);
            if (agents.length === 0) {
                await interaction.editReply("No custom agents configured for this session.");
                return;
            }
            const lines = agents.map((a, i) => `${i + 1}. **${a.displayName}** (\`${a.name}\`) — ${a.description}`);
            await interaction.editReply(truncateForDiscord(`**Available agents:**\n${lines.join("\n")}`));
        }
        else if (sub === "current") {
            await interaction.deferReply({ ephemeral: true });
            const agent = await sessions.getCurrentAgent(sessionKey);
            if (!agent) {
                await interaction.editReply("No agent selected (using default).");
                return;
            }
            await interaction.editReply(`**${agent.displayName}** (\`${agent.name}\`)\n> ${agent.description}`);
        }
        else if (sub === "select") {
            const name = interaction.options.getString("name", true);
            await interaction.deferReply({ ephemeral: true });
            const agent = await sessions.selectAgent(sessionKey, name);
            await interaction.editReply(`✅ Switched to agent **${agent.displayName}** (\`${agent.name}\`).`);
        }
        else if (sub === "deselect") {
            await interaction.deferReply({ ephemeral: true });
            await sessions.deselectAgent(sessionKey);
            await interaction.editReply("✅ Returned to default agent.");
        }
    }
    catch (err) {
        console.error(`[/agent ${sub}] Error:`, err);
        const msg = sub === "list" ? "❌ Failed to list agents." :
            sub === "current" ? "❌ Failed to get current agent." :
                sub === "select" ? "❌ Failed to select agent." :
                    "❌ Failed to deselect agent.";
        if (interaction.deferred)
            await interaction.editReply(msg).catch(() => { });
        else
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => { });
    }
}
