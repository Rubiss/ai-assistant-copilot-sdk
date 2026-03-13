import { REST, Routes } from "discord.js";
import { config } from "dotenv";
import { commands } from "../src/commands.js";
config();
const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APP_ID;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !appId || !guildId) {
    console.error("Missing required env vars: DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID");
    process.exit(1);
}
const rest = new REST({ version: "10" }).setToken(token);
const body = commands.map((cmd) => cmd.toJSON());
try {
    console.log(`Registering ${body.length} command(s) to guild ${guildId}...`);
    const result = await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    console.log(`✅ Registered ${result.length} command(s)`);
}
catch (err) {
    console.error("❌ Failed to register commands:", err);
    process.exit(1);
}
