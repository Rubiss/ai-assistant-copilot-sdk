import { truncateForDiscord } from "../../copilot.js";
export async function handleWorkspace(interaction, sessions) {
    const sub = interaction.options.getSubcommand(true);
    const sessionKey = interaction.channel?.isThread()
        ? interaction.channelId
        : interaction.user.id;
    const path = interaction.options.getString("path") ?? "";
    try {
        await interaction.deferReply({ ephemeral: true });
        if (sub === "list") {
            const files = await sessions.listWorkspaceFiles(sessionKey);
            if (files.length === 0) {
                await interaction.editReply("📁 Workspace is empty.");
            }
            else {
                const list = files.map((f, i) => `${i + 1}. \`${f}\``).join("\n");
                await interaction.editReply(truncateForDiscord(`📁 **Workspace files:**\n${list}`));
            }
        }
        else if (sub === "read") {
            const content = await sessions.readWorkspaceFile(sessionKey, path);
            await interaction.editReply(truncateForDiscord(`📄 **\`${path}\`:**\n\`\`\`\n${content}\n\`\`\``));
        }
        else if (sub === "create") {
            const content = interaction.options.getString("content", true);
            await sessions.createWorkspaceFile(sessionKey, path, content);
            await interaction.editReply(`✅ Created \`${path}\` in workspace.`);
        }
    }
    catch (err) {
        console.error(`[/workspace ${sub}] Error:`, err);
        const msg = sub === "list" ? "❌ Failed to list workspace files." :
            sub === "read" ? `❌ Failed to read \`${path}\` from workspace.` :
                `❌ Failed to create \`${path}\` in workspace.`;
        if (interaction.deferred)
            await interaction.editReply(msg).catch(() => { });
        else
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => { });
    }
}
