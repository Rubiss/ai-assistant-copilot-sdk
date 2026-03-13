import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Copilot a one-shot question (no session history)")
    .addStringOption((opt) =>
      opt
        .setName("prompt")
        .setDescription("Your question or prompt")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Chat with Copilot using persistent session history")
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("Your message")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Clear your Copilot session history"),

  new SlashCommandBuilder()
    .setName("servers")
    .setDescription("List all servers this bot is currently installed in"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Remove this bot from a server")
    .addStringOption((opt) =>
      opt
        .setName("guild_id")
        .setDescription("The server ID to leave (get IDs from /servers)")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("model")
    .setDescription("List available models or switch the model for your session")
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List all available models")
    )
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Switch to a different model (takes effect on your next message)")
        .addStringOption((opt) =>
          opt
            .setName("model_id")
            .setDescription("Model ID to switch to (e.g. claude-opus-4.5)")
            .setRequired(true)
        )
    ),
];

export type CommandName = "ask" | "chat" | "reset" | "servers" | "leave" | "model";
