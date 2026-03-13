import { ChatInputCommandInteraction } from "discord.js";
import { SessionManager, truncateForDiscord } from "../../copilot.js";

export async function handlePlan(
  interaction: ChatInputCommandInteraction,
  sessions: SessionManager
): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  const sessionKey = interaction.channel?.isThread()
    ? interaction.channelId
    : interaction.user.id;
  try {
    await interaction.deferReply({ ephemeral: true });
    if (sub === "read") {
      const result = await sessions.readPlan(sessionKey);
      if (!result.exists) {
        await interaction.editReply("📋 No plan exists for this session.");
      } else {
        let msg = truncateForDiscord(`📋 **Session Plan:**\n\`\`\`\n${result.content}\n\`\`\``);
        if (result.path) msg += `\n*Stored at: ${result.path}*`;
        await interaction.editReply(msg);
      }
    } else if (sub === "update") {
      const content = interaction.options.getString("content", true);
      await sessions.updatePlan(sessionKey, content);
      await interaction.editReply("✅ Plan updated.");
    } else if (sub === "delete") {
      await sessions.deletePlan(sessionKey);
      await interaction.editReply("✅ Plan deleted.");
    }
  } catch (err) {
    console.error(`[/plan ${sub}] Error:`, err);
    const msg =
      sub === "read" ? "❌ Failed to read plan." :
      sub === "update" ? "❌ Failed to update plan." :
      "❌ Failed to delete plan.";
    if (interaction.deferred) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
}
