import { chunkForDiscord } from "../../copilot.js";
import { resolveMessageLinks } from "../../utils/resolveMessageLinks.js";
import { downloadFileAttachments } from "../../utils/downloadAttachments.js";
export async function handleAsk(interaction, sessions) {
    const prompt = interaction.options.getString("prompt", true);
    const workspace = interaction.options.getString("workspace", false);
    const imageAttachment = interaction.options.getAttachment("image", false);
    const tempKey = `ask_tmp_${interaction.user.id}_${Date.now()}`;
    try {
        await interaction.deferReply({ ephemeral: true });
        let response;
        try {
            if (workspace)
                sessions.setSessionWorkingDir(tempKey, workspace);
            const enrichedPrompt = await resolveMessageLinks(prompt, interaction.client, interaction.user.id);
            let imagePaths;
            let cleanup;
            if (imageAttachment) {
                const result = await downloadFileAttachments([imageAttachment]);
                cleanup = result.cleanup;
                imagePaths = result.attachments.map((a) => ({ path: a.filePath, displayName: a.displayName }));
            }
            try {
                response = await sessions.sendMessage(tempKey, enrichedPrompt, imagePaths);
            }
            finally {
                // Temp file cleanup is independent of session reset — always run both
                await cleanup?.();
            }
        }
        finally {
            // Always clean up the temp session, even on error
            await sessions.resetSession(tempKey);
        }
        const chunks = chunkForDiscord(response);
        await interaction.editReply(chunks[0]);
        for (const chunk of chunks.slice(1)) {
            await interaction.followUp({ ephemeral: true, content: chunk });
        }
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
