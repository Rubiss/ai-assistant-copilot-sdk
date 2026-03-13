import { config } from "dotenv";
config();
import { SessionManager } from "./copilot.js";
import { createBot } from "./bot.js";
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error("❌ DISCORD_TOKEN is not set in .env");
    process.exit(1);
}
const sessions = new SessionManager();
const client = createBot(sessions);
async function shutdown(signal) {
    console.log(`\n${signal} received — shutting down...`);
    try {
        client.destroy();
        await sessions.shutdown();
        console.log("✅ Shutdown complete.");
    }
    catch (err) {
        console.error("Error during shutdown:", err);
    }
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
await client.login(token);
