import { ChatInputCommandInteraction, ThreadAutoArchiveDuration } from "discord.js";
import { SessionManager, truncateForDiscord } from "../../copilot.js";

export async function handleChat(
  interaction: ChatInputCommandInteraction,
  sessions: SessionManager
): Promise<void> {
  const message = interaction.options.getString("message", true);
  const workspace = interaction.options.getString("workspace", false);

  // DMs can't have threads — treat the whole DM as one persistent session
  if (interaction.channel?.isDMBased()) {
    try {
      await interaction.deferReply();
      if (workspace) sessions.setSessionWorkingDir(interaction.user.id, workspace);
      const response = await sessions.sendMessage(interaction.user.id, message);
      await interaction.editReply(truncateForDiscord(response));
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

    if (interaction.channel?.isThread()) {
      // Can't create a thread inside a thread — use the current thread as the session
      if (workspace) sessions.setSessionWorkingDir(interaction.channelId, workspace);
      const response = await sessions.sendMessage(interaction.channelId, message);
      await interaction.editReply(truncateForDiscord(response));
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
    const response = await sessions.sendMessage(thread.id, message);
    await thread.send(truncateForDiscord(response));

    await interaction.editReply(`💬 ${thread.toString()}`);
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
