import { ChatInputCommandInteraction } from "discord.js";
import { SessionManager, truncateForDiscord } from "../../copilot.js";

export async function handleChat(
  interaction: ChatInputCommandInteraction,
  sessions: SessionManager
): Promise<void> {
  const message = interaction.options.getString("message", true);

  try {
    await interaction.deferReply();
    const response = await sessions.sendMessage(interaction.user.id, message);
    await interaction.editReply(truncateForDiscord(response));
  } catch (err) {
    console.error("[/chat] Error:", err);
    const msg = "❌ Something went wrong talking to Copilot. Please try again.";
    if (interaction.deferred) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
}
