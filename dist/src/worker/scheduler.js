import { registry } from "../app/plugins/registry.js";
import * as scheduleRuns from "../app/store/scheduleRuns.js";
import { logAudit } from "../app/store/audit.js";
export class Scheduler {
    timers = new Map();
    running = false;
    start() {
        if (this.running)
            return;
        this.running = true;
        const schedules = registry.getAllSchedules("worker");
        if (schedules.length === 0) {
            console.log("[scheduler] No schedules registered.");
            return;
        }
        for (const schedule of schedules) {
            const key = schedule.name;
            console.log(`[scheduler] Registering "${key}" (every ${schedule.intervalMs}ms)`);
            const timer = setInterval(() => {
                this.executeSchedule(schedule).catch((err) => {
                    console.error(`[scheduler] Error in "${key}":`, err);
                });
            }, schedule.intervalMs);
            this.timers.set(key, timer);
        }
        console.log(`[scheduler] Started ${schedules.length} schedule(s).`);
    }
    get activeCount() {
        return this.timers.size;
    }
    stop() {
        if (!this.running)
            return;
        this.running = false;
        for (const [, timer] of this.timers) {
            clearInterval(timer);
        }
        this.timers.clear();
        console.log("[scheduler] Stopped all schedules.");
    }
    async executeSchedule(schedule) {
        const pluginName = this.findPluginName(schedule) ?? "unknown";
        const scheduleName = schedule.name;
        if (scheduleRuns.isRunning(pluginName, scheduleName)) {
            console.log(`[scheduler] Skipping "${scheduleName}" — still running.`);
            return;
        }
        const runId = scheduleRuns.insertRun(pluginName, scheduleName);
        scheduleRuns.startRun(runId);
        try {
            await schedule.run();
            scheduleRuns.completeRun(runId);
            try {
                logAudit({
                    process: "worker",
                    event_type: "schedule_complete",
                    target: scheduleName,
                    detail: { pluginName, runId },
                });
            }
            catch { /* audit is best-effort */ }
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            scheduleRuns.failRun(runId, error);
            try {
                logAudit({
                    process: "worker",
                    event_type: "schedule_error",
                    target: scheduleName,
                    detail: { pluginName, runId, error },
                });
            }
            catch { /* audit is best-effort */ }
            throw err;
        }
    }
    findPluginName(schedule) {
        for (const plugin of registry.getPluginsForProcess("worker")) {
            const schedules = plugin.contributions.worker?.schedules ?? [];
            if (schedules.some((s) => s.name === schedule.name)) {
                return plugin.name;
            }
        }
        return null;
    }
}
