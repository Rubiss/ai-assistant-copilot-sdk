import { loadEnv, CONFIG_DIR } from "../app/config/env.js";
import { loadRuntimeConfig } from "../app/config/runtimeConfig.js";
import { registry } from "../app/plugins/registry.js";
import { logAudit } from "../app/store/audit.js";
export async function startWorker() {
    loadEnv("worker");
    const config = loadRuntimeConfig();
    // TODO: Register plugins here (Phase 3+)
    await registry.initAll({ configDir: CONFIG_DIR, processType: "worker" }, Object.fromEntries(Object.entries(config.plugins).map(([name, cfg]) => [name, cfg])));
    console.log("⚙️  Worker process started.");
    console.log(`   Config dir: ${CONFIG_DIR}`);
    console.log(`   Plugins loaded: ${registry.getPluginsForProcess("worker").map(p => p.name).join(", ") || "(none)"}`);
    try {
        logAudit({ process: "worker", event_type: "startup" });
    }
    catch { /* db may not be ready */ }
    // TODO: Start HTTP server (Phase 4)
    // TODO: Start scheduler (Phase 4)
    // TODO: Start watchers (Phase 6)
    // Keep process alive
    const keepAlive = setInterval(() => { }, 60_000);
    async function shutdown(signal) {
        console.log(`\n${signal} received — shutting down worker...`);
        clearInterval(keepAlive);
        try {
            await registry.shutdownAll();
            console.log("✅ Worker shutdown complete.");
        }
        catch (err) {
            console.error("Error during worker shutdown:", err);
        }
        try {
            logAudit({ process: "worker", event_type: "shutdown" });
        }
        catch { /* best-effort */ }
        process.exit(0);
    }
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}
