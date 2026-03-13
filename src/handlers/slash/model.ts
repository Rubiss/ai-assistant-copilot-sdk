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
      // Use thread ID as session key when inside a thread (matches /chat thread sessions)
      const sessionKey = interaction.channel?.isThread()
        ? interaction.channelId
        : interaction.user.id;
      await interaction.deferReply({ ephemeral: true });
      await sessions.setModel(sessionKey, modelId);
      const scope = interaction.channel?.isThread() ? "for this thread" : "for your session";
      await interaction.editReply(`✅ Model switched to \`${modelId}\` ${scope}. Takes effect on the next message.`);
    } else if (sub === "current") {
      const sessionKey = interaction.channel?.isThread() ? interaction.channelId : interaction.user.id;
      await interaction.deferReply({ ephemeral: true });
      const modelId = await sessions.getCurrentModel(sessionKey);
      const scope = interaction.channel?.isThread() ? "this thread" : "your session";
      await interaction.editReply(
        modelId
          ? `🤖 Current model for ${scope}: \`${modelId}\``
          : `🤖 No model explicitly set for ${scope} (using session default).`
      );
    }
  } catch (err) {
    console.error(`[/model ${sub}] Error:`, err);
    const msg = `❌ Failed to ${sub === "list" ? "list models" : sub === "current" ? "get current model" : "switch model"}. Please try again.`;
    if (interaction.deferred) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
}
