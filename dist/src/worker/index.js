import { loadEnv, CONFIG_DIR } from "../app/config/env.js";
import { loadRuntimeConfig } from "../app/config/runtimeConfig.js";
import { registry } from "../app/plugins/registry.js";
import { logAudit } from "../app/store/audit.js";
import { runMigrations } from "../app/store/index.js";
import { closeDb } from "../app/store/db.js";
import { createHttpServer, stopHttpServer } from "./httpServer.js";
import { Scheduler } from "./scheduler.js";
import { registerHealthContext } from "./health.js";
export async function startWorker() {
    loadEnv("worker");
    const config = loadRuntimeConfig();
    await registry.initAll({ configDir: CONFIG_DIR, processType: "worker" }, Object.fromEntries(Object.entries(config.plugins).map(([name, cfg]) => [name, cfg])));
    console.log("⚙️  Worker process started.");
    console.log(`   Config dir: ${CONFIG_DIR}`);
    console.log(`   Plugins loaded: ${registry.getPluginsForProcess("worker").map(p => p.name).join(", ") || "(none)"}`);
    try {
        logAudit({ process: "worker", event_type: "startup" });
    }
    catch { /* db may not be ready */ }
    runMigrations();
    const server = await createHttpServer();
    const scheduler = new Scheduler();
    scheduler.start();
    registerHealthContext({ scheduler, httpListening: true });
    // TODO: Start watchers (Phase 6)
    // Keep process alive
    const keepAlive = setInterval(() => { }, 60_000);
    async function shutdown(signal) {
        console.log(`\n${signal} received — shutting down worker...`);
        scheduler.stop();
        await stopHttpServer(server);
        try {
            await registry.shutdownAll();
            console.log("✅ Worker shutdown complete.");
        }
        catch (err) {
            console.error("Error during worker shutdown:", err);
        }
        clearInterval(keepAlive);
        try {
            logAudit({ process: "worker", event_type: "shutdown" });
        }
        catch { /* best-effort */ }
        closeDb();
        process.exit(0);
    }
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}
