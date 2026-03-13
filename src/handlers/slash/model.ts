import { ChatInputCommandInteraction } from "discord.js";
import { SessionManager, truncateForDiscord } from "../../copilot.js";

export async function handleModel(
  interaction: ChatInputCommandInteraction,
  sessions: SessionManager
): Promise<void> {
  const sub = interaction.options.getSubcommand(true);

  try {
    if (sub === "list") {
      await interaction.deferReply({ ephemeral: true });
      const models = await sessions.listModels();
      if (models.length === 0) {
        await interaction.editReply("No models available.");
        return;
      }
      const lines = models.map((m) => `\`${m.id}\` — ${m.name}`);
      await interaction.editReply(truncateForDiscord(`**Available models:**\n${lines.join("\n")}`));
    } else if (sub === "set") {
      const modelId = interaction.options.getString("model_id", true);
      await interaction.deferReply({ ephemeral: true });
      await sessions.setModel(interaction.user.id, modelId);
      await interaction.editReply(`✅ Model switched to \`${modelId}\`. Takes effect on your next message.`);
    }
  } catch (err) {
    console.error(`[/model ${sub}] Error:`, err);
    const msg = `❌ Failed to ${sub === "list" ? "list models" : "switch model"}. Please try again.`;
    if (interaction.deferred) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
}
