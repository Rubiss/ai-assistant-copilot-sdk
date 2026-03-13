import { ChatInputCommandInteraction, Client } from "discord.js";

export async function handleLeave(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  const guildId = interaction.options.getString("guild_id", true).trim();

  await interaction.deferReply({ ephemeral: true });

  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    await interaction.editReply(
      `❌ No server found with ID \`${guildId}\`. Use \`/servers\` to see all installed servers.`
    );
    return;
  }

  const guildName = guild.name;

  try {
    await guild.leave();
    await interaction.editReply(`✅ Left server **${guildName}** (\`${guildId}\`).`);
  } catch (err) {
    console.error(`[/leave] Failed to leave guild ${guildId}:`, err);
    await interaction.editReply(
      `❌ Failed to leave **${guildName}**. Check bot permissions and try again.`
    );
  }
}
