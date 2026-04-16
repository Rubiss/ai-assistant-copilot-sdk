import { getDb } from "../app/store/db.js";
import { registry } from "../app/plugins/registry.js";
let ctx = {};
export function registerHealthContext(context) {
    ctx = context;
}
export function getHealthStatus() {
    const plugins = registry.getPluginsForProcess("worker").map((p) => p.name);
    let database = false;
    try {
        getDb().pragma("integrity_check");
        database = true;
    }
    catch { /* database unavailable */ }
    const active = ctx.scheduler?.activeCount ?? 0;
    const httpServer = ctx.httpListening ?? false;
    const status = database ? "ok" : "degraded";
    return {
        status,
        uptime: process.uptime(),
        plugins,
        database,
        scheduler: { active },
        httpServer,
    };
}
