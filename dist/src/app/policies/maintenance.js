export function isInMaintenanceWindow(config, now) {
    const date = now ?? new Date();
    const dayOfWeek = date.getUTCDay();
    const hour = date.getUTCHours();
    if (!config.dayOfWeek.includes(dayOfWeek))
        return false;
    if (config.startHour <= config.endHour) {
        return hour >= config.startHour && hour < config.endHour;
    }
    else {
        // Wraps midnight
        return hour >= config.startHour || hour < config.endHour;
    }
}
export function shouldSuppressAlert(config, severity, now) {
    if (!isInMaintenanceWindow(config, now))
        return false;
    if (!config.suppressSeverities || config.suppressSeverities.length === 0)
        return false;
    return config.suppressSeverities.includes(severity);
}
