import { ChatInputCommandInteraction, ThreadAutoArchiveDuration } from "discord.js";
import { SessionManager, chunkForDiscord } from "../../copilot.js";
import { resolveMessageLinks } from "../../utils/resolveMessageLinks.js";
import { downloadFileAttachments } from "../../utils/downloadAttachments.js";

export async function handleChat(
  interaction: ChatInputCommandInteraction,
  sessions: SessionManager
): Promise<void> {
  const message = interaction.options.getString("message", true);
  const workspace = interaction.options.getString("workspace", false);
  const imageAttachment = interaction.options.getAttachment("image", false);

  // DMs can't have threads — treat the whole DM as one persistent session
  if (interaction.channel?.isDMBased()) {
    try {
      await interaction.deferReply();
      // Resolve after defer to avoid hitting Discord's 3s interaction window
      const enrichedMessage = await resolveMessageLinks(message, interaction.client, interaction.user.id);
      if (workspace) sessions.setSessionWorkingDir(interaction.user.id, workspace);

      let imagePaths: Array<{ path: string; displayName?: string }> | undefined;
      let cleanup: (() => Promise<void>) | undefined;
      if (imageAttachment) {
        const result = await downloadFileAttachments([imageAttachment]);
        cleanup = result.cleanup;
        imagePaths = result.attachments.map((a) => ({ path: a.filePath, displayName: a.displayName }));
      }

      let response: string;
      try {
        response = await sessions.sendMessage(interaction.user.id, enrichedMessage, imagePaths);
      } finally {
        await cleanup?.();
      }

      const chunks = chunkForDiscord(response);
      await interaction.editReply(chunks[0]);
      for (const chunk of chunks.slice(1)) {
        await interaction.followUp({ content: chunk });
      }
    } catch (err) {
      console.error("[/chat DM] Error:", err);
      const isPathError = err instanceof Error && err.message.startsWith("Workspace path") || err instanceof Error && err.message === "Invalid workspace path.";
      const msg = isPathError
        ? `❌ Invalid workspace: ${(err as Error).message}`
        : "❌ Something went wrong talking to Copilot. Please try again.";
      if (interaction.deferred) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  // Channel: spawn a public thread — each /chat gets its own isolated context.
  // If already inside a thread, reuse it instead of trying to nest threads.
  try {
    await interaction.deferReply();
    // Resolve after defer to avoid hitting Discord's 3s interaction window
    const enrichedMessage = await resolveMessageLinks(message, interaction.client, interaction.user.id);

    let imagePaths: Array<{ path: string; displayName?: string }> | undefined;
    let cleanup: (() => Promise<void>) | undefined;
    if (imageAttachment) {
      const result = await downloadFileAttachments([imageAttachment]);
      cleanup = result.cleanup;
      imagePaths = result.attachments.map((a) => ({ path: a.filePath, displayName: a.displayName }));
    }

    try {
      if (interaction.channel?.isThread()) {
        // Can't create a thread inside a thread — use the current thread as the session
        if (workspace) sessions.setSessionWorkingDir(interaction.channelId, workspace);
        const response = await sessions.sendMessage(interaction.channelId, enrichedMessage, imagePaths);
        const chunks = chunkForDiscord(response);
        await interaction.editReply(chunks[0]);
        for (const chunk of chunks.slice(1)) {
          await interaction.followUp({ content: chunk });
        }
        return;
      }

      const replyMsg = await interaction.fetchReply();

      const safeName = message.replace(/[\r\n]+/g, " ");
      const threadName = `Copilot: ${safeName.slice(0, 50)}${safeName.length > 50 ? "…" : ""}`;
      const thread = await replyMsg.startThread({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      });

      // Session keyed by thread ID — fully isolated per conversation
      if (workspace) sessions.setSessionWorkingDir(thread.id, workspace);
      const response = await sessions.sendMessage(thread.id, enrichedMessage, imagePaths);
      for (const chunk of chunkForDiscord(response)) {
        await thread.send(chunk);
      }

      await interaction.editReply(`💬 ${thread.toString()}`);
    } finally {
      await cleanup?.();
    }
  } catch (err) {
    console.error("[/chat] Error:", err);
    const isPathError = err instanceof Error && (err.message.startsWith("Workspace path") || err.message === "Invalid workspace path.");
    const msg = isPathError
      ? `❌ Invalid workspace: ${(err as Error).message}`
      : "❌ Something went wrong talking to Copilot. Please try again.";
    if (interaction.deferred) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
}
