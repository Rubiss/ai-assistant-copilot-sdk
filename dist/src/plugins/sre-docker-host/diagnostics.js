import * as docker from "../../adapters/docker.js";
import { findServiceByContainer, } from "./serviceLookup.js";
/* ------------------------------------------------------------------ */
/*  Collector                                                          */
/* ------------------------------------------------------------------ */
export async function collectDiagnostics(containerId, services) {
    const inspect = await docker.inspectContainer(containerId);
    const containerName = inspect.Name.replace(/^\//, "");
    // Logs (may fail for stopped containers)
    let logs = "";
    try {
        logs = await docker.getContainerLogs(containerId, 100);
    }
    catch {
        /* container might be stopped */
    }
    // Stats (only if running)
    let resources = null;
    if (inspect.State.Running) {
        try {
            const stats = await docker.getContainerStats(containerId);
            const cpuDelta = stats.cpu_stats.cpu_usage.total_usage -
                stats.precpu_stats.cpu_usage.total_usage;
            const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
            resources = {
                cpuPercent: systemDelta > 0
                    ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100
                    : 0,
                memoryUsage: stats.memory_stats.usage,
                memoryLimit: stats.memory_stats.limit,
                memoryPercent: stats.memory_stats.limit > 0
                    ? (stats.memory_stats.usage / stats.memory_stats.limit) * 100
                    : 0,
            };
        }
        catch {
            /* stats unavailable */
        }
    }
    // Service definition from compose files
    const service = findServiceByContainer(services, containerName) ?? null;
    // Related containers (depends_on from compose)
    const relatedContainers = [];
    if (service?.depends_on) {
        try {
            const allContainers = await docker.listContainers(true);
            for (const dep of service.depends_on) {
                const container = allContainers.find((c) => c.Names.some((n) => n.includes(dep)));
                if (container) {
                    relatedContainers.push({
                        name: container.Names[0]?.replace(/^\//, "") ?? dep,
                        state: container.State,
                    });
                }
            }
        }
        catch {
            /* Docker unavailable */
        }
    }
    return {
        container: {
            id: inspect.Id,
            name: containerName,
            image: inspect.Config.Image,
            state: inspect.State.Status,
            health: inspect.State.Health?.Status,
            restartCount: 0,
            startedAt: inspect.State.StartedAt,
            exitCode: inspect.State.ExitCode,
        },
        logs,
        resources,
        service,
        relatedContainers,
    };
}
