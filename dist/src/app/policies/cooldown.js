import { getState, setState } from "../store/pluginState.js";
const PLUGIN_NAME = "_policy_engine";
export function recordAction(action, service) {
    const key = `cooldown:${action}:${service}`;
    setState(PLUGIN_NAME, key, new Date().toISOString());
}
export function getLastActionTime(action, service) {
    const key = `cooldown:${action}:${service}`;
    const value = getState(PLUGIN_NAME, key);
    return value ? new Date(value) : null;
}
export function isInCooldown(action, service, cooldownMs) {
    const last = getLastActionTime(action, service);
    if (!last)
        return false;
    return Date.now() - last.getTime() < cooldownMs;
}
