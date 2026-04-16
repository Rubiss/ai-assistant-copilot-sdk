import { loadEnv, env } from "../app/config/env.js";
import { loadRuntimeConfig } from "../app/config/runtimeConfig.js";
import { registry } from "../app/plugins/registry.js";
import { CONFIG_DIR } from "../app/config/env.js";
import { SessionManager } from "../app/copilot/interactiveSessions.js";
import { createBot } from "./discordClient.js";
import { chatCorePlugin } from "../plugins/chat-core/index.js";
import { sreDockerHostPlugin } from "../plugins/sre-docker-host/index.js";
const BUILTIN_PLUGINS = [chatCorePlugin, sreDockerHostPlugin];
export async function startBot() {
    loadEnv("bot");
    const config = loadRuntimeConfig();
    const token = env("DISCORD_TOKEN", true);
    for (const plugin of BUILTIN_PLUGINS) {
        if (config.plugins[plugin.name]?.enabled !== false) {
            registry.registerPlugin(plugin);
        }
    }
    await registry.initAll({ configDir: CONFIG_DIR, processType: "bot" }, Object.fromEntries(Object.entries(config.plugins).map(([name, cfg]) => [name, cfg])));
    const sessions = new SessionManager();
    const client = createBot(sessions);
    async function shutdown(signal) {
        console.log(`\n${signal} received — shutting down bot...`);
        try {
            client.destroy();
            await registry.shutdownAll();
            await sessions.shutdown();
            console.log("✅ Bot shutdown complete.");
        }
        catch (err) {
            console.error("Error during bot shutdown:", err);
        }
        process.exit(0);
    }
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    await client.login(token);
    console.log("🤖 Bot process started.");
}
