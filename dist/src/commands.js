import { SlashCommandBuilder } from "discord.js";
export const commands = [
    new SlashCommandBuilder()
        .setName("ask")
        .setDescription("Ask Copilot a one-shot question (no session history)")
        .addStringOption((opt) => opt
        .setName("prompt")
        .setDescription("Your question or prompt")
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName("workspace")
        .setDescription("Path to a workspace directory to load .vscode/mcp.json from (e.g. /mnt/e/Docker)")
        .setRequired(false)),
    new SlashCommandBuilder()
        .setName("chat")
        .setDescription("Chat with Copilot using persistent session history")
        .addStringOption((opt) => opt
        .setName("message")
        .setDescription("Your message")
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName("workspace")
        .setDescription("Path to a workspace directory to load .vscode/mcp.json from (e.g. /mnt/e/Docker)")
        .setRequired(false)),
    new SlashCommandBuilder()
        .setName("reset")
        .setDescription("Clear your Copilot session history"),
    new SlashCommandBuilder()
        .setName("servers")
        .setDescription("List all servers this bot is currently installed in"),
    new SlashCommandBuilder()
        .setName("leave")
        .setDescription("Remove this bot from a server")
        .addStringOption((opt) => opt
        .setName("guild_id")
        .setDescription("The server ID to leave (get IDs from /servers)")
        .setRequired(true)),
    new SlashCommandBuilder()
        .setName("model")
        .setDescription("List available models or switch the model for your session")
        .addSubcommand((sub) => sub.setName("list").setDescription("List all available models"))
        .addSubcommand((sub) => sub
        .setName("set")
        .setDescription("Switch to a different model (takes effect on your next message)")
        .addStringOption((opt) => opt
        .setName("model_id")
        .setDescription("Model ID to switch to (e.g. claude-opus-4.5)")
        .setRequired(true)))
        .addSubcommand((sub) => sub.setName("current").setDescription("Show the current model for your session")),
    new SlashCommandBuilder()
        .setName("status")
        .setDescription("Show Copilot auth status and CLI version"),
    new SlashCommandBuilder()
        .setName("history")
        .setDescription("Show your recent conversation history")
        .addIntegerOption((opt) => opt
        .setName("count")
        .setDescription("Number of exchanges to show (default: 5, max: 20)")
        .setMinValue(1)
        .setMaxValue(20)),
    new SlashCommandBuilder()
        .setName("agent")
        .setDescription("Manage custom agents for your session")
        .addSubcommand((sub) => sub.setName("list").setDescription("List available custom agents"))
        .addSubcommand((sub) => sub.setName("current").setDescription("Show the currently active agent"))
        .addSubcommand((sub) => sub
        .setName("select")
        .setDescription("Switch to a custom agent")
        .addStringOption((opt) => opt.setName("name").setDescription("Agent name").setRequired(true)))
        .addSubcommand((sub) => sub.setName("deselect").setDescription("Return to the default agent")),
    new SlashCommandBuilder()
        .setName("mode")
        .setDescription("Manage session mode")
        .addSubcommand((sub) => sub.setName("get").setDescription("Show the current session mode"))
        .addSubcommand((sub) => sub
        .setName("set")
        .setDescription("Switch session mode")
        .addStringOption((opt) => opt
        .setName("mode")
        .setDescription("Session mode to switch to")
        .setRequired(true)
        .addChoices({ name: "Interactive", value: "interactive" }, { name: "Plan", value: "plan" }, { name: "Autopilot", value: "autopilot" }))),
    new SlashCommandBuilder()
        .setName("compact")
        .setDescription("Compact session context to free up token space"),
    new SlashCommandBuilder()
        .setName("fleet")
        .setDescription("Start fleet mode for the session")
        .addStringOption((opt) => opt
        .setName("prompt")
        .setDescription("Optional prompt to combine with fleet instructions")),
    new SlashCommandBuilder()
        .setName("plan")
        .setDescription("Manage the session plan")
        .addSubcommand((sub) => sub.setName("read").setDescription("Show the current session plan"))
        .addSubcommand((sub) => sub
        .setName("update")
        .setDescription("Update the session plan")
        .addStringOption((opt) => opt.setName("content").setDescription("New plan content").setRequired(true)))
        .addSubcommand((sub) => sub.setName("delete").setDescription("Delete the session plan")),
    new SlashCommandBuilder()
        .setName("mcp")
        .setDescription("Manage MCP servers for your session")
        .addSubcommand((sub) => sub.setName("list").setDescription("List all MCP servers"))
        .addSubcommand((sub) => sub
        .setName("enable")
        .setDescription("Enable an MCP server")
        .addStringOption((opt) => opt.setName("server").setDescription("Server name to enable").setRequired(true)))
        .addSubcommand((sub) => sub
        .setName("disable")
        .setDescription("Disable an MCP server")
        .addStringOption((opt) => opt.setName("server").setDescription("Server name to disable").setRequired(true)))
        .addSubcommand((sub) => sub
        .setName("workspace")
        .setDescription("Set the workspace directory to load .vscode/mcp.json from")
        .addStringOption((opt) => opt
        .setName("path")
        .setDescription("Workspace directory path, e.g. /mnt/e/Docker")
        .setRequired(true))),
    new SlashCommandBuilder()
        .setName("workspace")
        .setDescription("Manage workspace files")
        .addSubcommand((sub) => sub.setName("list").setDescription("List files in the session workspace"))
        .addSubcommand((sub) => sub
        .setName("read")
        .setDescription("Read a file from the session workspace")
        .addStringOption((opt) => opt.setName("path").setDescription("Relative file path").setRequired(true)))
        .addSubcommand((sub) => sub
        .setName("create")
        .setDescription("Create or overwrite a file in the session workspace")
        .addStringOption((opt) => opt.setName("path").setDescription("Relative file path").setRequired(true))
        .addStringOption((opt) => opt.setName("content").setDescription("File content").setRequired(true))),
];
