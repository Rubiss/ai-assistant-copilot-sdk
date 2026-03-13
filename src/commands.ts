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
];

export type CommandName = "ask" | "chat" | "reset";
