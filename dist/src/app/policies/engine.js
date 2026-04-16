import { getState, setState } from "../store/pluginState.js";
import { logAudit } from "../store/audit.js";
import { isInCooldown, recordAction } from "./cooldown.js";
import { isInMaintenanceWindow } from "./maintenance.js";
const PLUGIN_NAME = "_policy_engine";
function matchesPattern(pattern, value) {
    if (pattern === "*")
        return true;
    return pattern === value;
}
export class PolicyEngine {
    rules = [];
    addRule(rule) {
        this.rules.push(rule);
    }
    removeRule(name) {
        this.rules = this.rules.filter((r) => r.name !== name);
    }
    getRules() {
        return [...this.rules];
    }
    evaluate(context) {
        for (const rule of this.rules) {
            const result = this.evaluateRule(rule, context);
            if (!result.allowed) {
                try {
                    logAudit({
                        process: "worker",
                        event_type: "policy_denied",
                        target: context.action,
                        detail: { rule: rule.name, reason: result.reason },
                    });
                }
                catch { }
                return result;
            }
            if (result.requiresApproval) {
                try {
                    logAudit({
                        process: "worker",
                        event_type: "policy_approval_required",
                        target: context.action,
                        detail: { rule: rule.name },
                    });
                }
                catch { }
                return result;
            }
        }
        return { allowed: true };
    }
    evaluateRule(rule, context) {
        switch (rule.type) {
            case "denylist":
                return this.evaluateDenylist(rule.config, context);
            case "allowlist":
                return this.evaluateAllowlist(rule.config, context);
            case "cooldown":
                return this.evaluateCooldown(rule, context);
            case "rateLimit":
                return this.evaluateRateLimit(rule, context);
            case "maintenanceWindow":
                return this.evaluateMaintenanceWindow(rule.config, context);
            default:
                return { allowed: true };
        }
    }
    evaluateDenylist(config, context) {
        const actionMatch = config.actions.some((a) => matchesPattern(a, context.action));
        const serviceMatch = !context.service ||
            config.services.some((s) => matchesPattern(s, context.service));
        if (actionMatch && serviceMatch) {
            return {
                allowed: false,
                reason: `Action "${context.action}" is denied by policy`,
            };
        }
        return { allowed: true };
    }
    evaluateAllowlist(config, context) {
        const actionMatch = config.actions.some((a) => matchesPattern(a, context.action));
        const serviceMatch = !context.service ||
            config.services.some((s) => matchesPattern(s, context.service));
        if (!actionMatch || !serviceMatch) {
            return {
                allowed: false,
                reason: `Action "${context.action}" is not in the allowlist`,
            };
        }
        return { allowed: true };
    }
    evaluateCooldown(rule, context) {
        const config = rule.config;
        if (!matchesPattern(config.actionPattern, context.action)) {
            return { allowed: true };
        }
        if (config.servicePattern &&
            context.service &&
            !matchesPattern(config.servicePattern, context.service)) {
            return { allowed: true };
        }
        const service = context.service ?? "_global";
        if (isInCooldown(context.action, service, config.cooldownMs)) {
            return {
                allowed: false,
                reason: `Action "${context.action}" is in cooldown (${config.cooldownMs}ms)`,
            };
        }
        recordAction(context.action, service);
        return { allowed: true };
    }
    evaluateRateLimit(rule, context) {
        const config = rule.config;
        if (!matchesPattern(config.actionPattern, context.action)) {
            return { allowed: true };
        }
        const windowKey = Math.floor(Date.now() / config.windowMs).toString();
        const stateKey = `ratelimit:${context.action}:${windowKey}`;
        const current = getState(PLUGIN_NAME, stateKey);
        const count = current ? parseInt(current, 10) : 0;
        if (count >= config.maxActions) {
            return {
                allowed: false,
                reason: `Rate limit exceeded for "${context.action}" (${config.maxActions}/${config.windowMs}ms)`,
            };
        }
        setState(PLUGIN_NAME, stateKey, (count + 1).toString());
        return { allowed: true };
    }
    evaluateMaintenanceWindow(config, context) {
        if (!isInMaintenanceWindow(config)) {
            return { allowed: true };
        }
        if (config.suppressSeverities &&
            context.severity &&
            config.suppressSeverities.includes(context.severity)) {
            return {
                allowed: false,
                reason: `Suppressed during maintenance window (severity: ${context.severity})`,
            };
        }
        return { allowed: true, requiresApproval: true };
    }
}
export const policyEngine = new PolicyEngine();
