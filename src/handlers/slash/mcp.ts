import { ChatInputCommandInteraction } from "discord.js";
import { SessionManager } from "../../copilot.js";

export async function handleMcp(
  interaction: ChatInputCommandInteraction,
  sessions: SessionManager
): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  const sessionKey = interaction.channel?.isThread()
    ? interaction.channelId
    : interaction.user.id;
  try {
    if (sub === "list") {
      const servers = sessions.getMcpStatus(sessionKey);
      const workingDir = sessions.getSessionWorkingDir(sessionKey);

      let content: string;

      if (servers.length === 0) {
        const header = workingDir
          ? `🔌 **MCP Servers** 📁 Workspace: \`${workingDir}\`\n\n`
          : `🔌 **MCP Servers**\n\n`;
        content =
          header +
          "No MCP servers configured. Add them to `~/.config/Code/User/mcp.json` or `<workspace>/.vscode/mcp.json`.";
      } else {
        const workspaceInfo = workingDir
          ? `\n📁 Workspace: \`${workingDir}\``
          : "";
        const lines = servers.map((s) => {
          const scope = s.source === "global" ? "global" : "workspace";
          if (s.skipped) {
            return `• ⚠️ ${s.name} (${scope}, skipped — unresolved \${input:...} values)`;
          } else if (!s.enabled) {
            return `• ❌ ${s.name} (${scope}, disabled)`;
          } else {
            return `• ✅ ${s.name} (${scope})`;
          }
        });
        content = `🔌 **MCP Servers**${workspaceInfo}\n\n${lines.join("\n")}`;
      }

      await interaction.reply({ content, ephemeral: true });
    } else if (sub === "enable") {
      const server = interaction.options.getString("server", true);
      sessions.setSessionMcpEnabled(sessionKey, server, true);
      await interaction.reply({
        content: `✅ **${server}** enabled. Run \`/reset\` to start a new session with this configuration.`,
        ephemeral: true,
      });
    } else if (sub === "disable") {
      const server = interaction.options.getString("server", true);
      sessions.setSessionMcpEnabled(sessionKey, server, false);
      await interaction.reply({
        content: `✅ **${server}** disabled. Run \`/reset\` to apply changes.`,
        ephemeral: true,
      });
    } else if (sub === "workspace") {
      const pathValue = interaction.options.getString("path", true);
      sessions.setSessionWorkingDir(sessionKey, pathValue);
      await interaction.reply({
        content: `✅ Workspace set to \`${pathValue}\`. Run \`/reset\` to start a new session with this workspace's MCP servers.`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error(`[/mcp ${sub}] Error:`, err);
    const msg = "❌ Failed to execute MCP command.";
    if (interaction.deferred) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
}
