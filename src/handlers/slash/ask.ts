import { AttachmentBuilder, ChatInputCommandInteraction } from "discord.js";
import { SessionManager, prepareDiscordResponse } from "../../copilot.js";
import { resolveMessageLinks } from "../../utils/resolveMessageLinks.js";
import { downloadFileAttachments } from "../../utils/downloadAttachments.js";

export async function handleAsk(
  interaction: ChatInputCommandInteraction,
  sessions: SessionManager
): Promise<void> {
  const prompt = interaction.options.getString("prompt", true);
  const workspace = interaction.options.getString("workspace", false);
  const fileAttachment = interaction.options.getAttachment("file", false);
  const tempKey = `ask_tmp_${interaction.user.id}_${Date.now()}`;

  try {
    await interaction.deferReply({ ephemeral: true });

    let response: string;
    try {
      if (workspace) sessions.setSessionWorkingDir(tempKey, workspace);
      const enrichedPrompt = await resolveMessageLinks(prompt, interaction.client, interaction.user.id);

      let imagePaths: Array<{ path: string; displayName?: string }> | undefined;
      let cleanup: (() => Promise<void>) | undefined;
      if (fileAttachment) {
        const result = await downloadFileAttachments([fileAttachment]);
        cleanup = result.cleanup;
        imagePaths = result.attachments.map((a) => ({ path: a.filePath, displayName: a.displayName }));
      }

      try {
        response = await sessions.sendMessage(tempKey, enrichedPrompt, imagePaths);
      } finally {
        // Temp file cleanup is independent of session reset — always run both
        await cleanup?.();
      }
    } finally {
      // Always clean up the temp session, even on error
      await sessions.resetSession(tempKey);
    }

    const { chunks, file } = prepareDiscordResponse(response);
    const files = file ? [new AttachmentBuilder(file.buffer, { name: file.name })] : [];
    await interaction.editReply({ content: chunks[0], files });
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ ephemeral: true, content: chunk });
    }
  } catch (err) {
    console.error("[/ask] Error:", err);
    const msg = "❌ Something went wrong talking to Copilot. Please try again.";
    if (interaction.deferred) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
}
