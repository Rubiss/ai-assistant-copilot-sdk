import { getDb } from "../app/store/db.js";
import { registry } from "../app/plugins/registry.js";
import type { Scheduler } from "./scheduler.js";

export interface HealthStatus {
  status: "ok" | "degraded";
  uptime: number;
  plugins: string[];
  database: boolean;
  scheduler: { active: number };
  httpServer: boolean;
}

interface HealthContext {
  scheduler?: Scheduler;
  httpListening?: boolean;
}

let ctx: HealthContext = {};

export function registerHealthContext(context: HealthContext): void {
  ctx = context;
}

export function getHealthStatus(): HealthStatus {
  const plugins = registry.getPluginsForProcess("worker").map((p) => p.name);

  let database = false;
  try {
    getDb().pragma("integrity_check");
    database = true;
  } catch { /* database unavailable */ }

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
