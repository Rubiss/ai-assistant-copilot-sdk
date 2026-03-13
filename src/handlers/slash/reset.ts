import { ChatInputCommandInteraction } from "discord.js";
import { SessionManager } from "../../copilot.js";

export async function handleReset(
  interaction: ChatInputCommandInteraction,
  sessions: SessionManager
): Promise<void> {
  try {
    await sessions.resetSession(interaction.user.id);
    await interaction.reply({
      content: "✅ Your Copilot session has been reset.",
      ephemeral: true,
    });
  } catch (err) {
    console.error("[/reset] Error:", err);
    await interaction.reply({
      content: "❌ Failed to reset session. Please try again.",
      ephemeral: true,
    });
  }
}
