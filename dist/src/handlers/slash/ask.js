import { truncateForDiscord } from "../../copilot.js";
export async function handleAsk(interaction, sessions) {
    const prompt = interaction.options.getString("prompt", true);
    const workspace = interaction.options.getString("workspace", false);
    const tempKey = `ask_tmp_${interaction.user.id}_${Date.now()}`;
    try {
        await interaction.deferReply({ ephemeral: true });
        let response;
        try {
            if (workspace)
                sessions.setSessionWorkingDir(tempKey, workspace);
            response = await sessions.sendMessage(tempKey, prompt);
        }
        finally {
            // Always clean up the temp session, even on error
            await sessions.resetSession(tempKey);
        }
        await interaction.editReply(truncateForDiscord(response));
    }
    catch (err) {
        console.error("[/ask] Error:", err);
        const msg = "❌ Something went wrong talking to Copilot. Please try again.";
        if (interaction.deferred) {
            await interaction.editReply(msg).catch(() => { });
        }
        else {
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => { });
        }
    }
}
