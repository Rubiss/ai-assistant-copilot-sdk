import { ChatInputCommandInteraction, Client } from "discord.js";

export async function handleServers(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guilds = client.guilds.cache;

  if (guilds.size === 0) {
    await interaction.editReply("ℹ️ This bot is not installed in any servers.");
    return;
  }

  const lines = guilds.map(
    (g) => `• **${g.name}** — ID: \`${g.id}\` (${g.memberCount ?? "?"} members)`
  );

  await interaction.editReply(
    `**Servers this bot is installed in (${guilds.size}):**\n${lines.join("\n")}`
  );
}
