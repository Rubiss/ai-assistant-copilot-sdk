import { policyEngine } from "../policies/engine.js";
import { logAudit } from "../store/audit.js";
import { getIncident } from "../store/incidents.js";
export async function onPreToolUse(ctx, event) {
    const policyContext = {
        action: `tool:${event.toolName}`,
        actor: ctx.actor,
        metadata: {
            sessionId: ctx.sessionId,
            incidentId: ctx.incidentId,
            arguments: event.arguments,
        },
    };
    const result = policyEngine.evaluate(policyContext);
    if (!result.allowed) {
        try {
            logAudit({
                process: ctx.processType,
                event_type: "tool_blocked",
                actor: ctx.actor,
                target: event.toolName,
                detail: { reason: result.reason, sessionId: ctx.sessionId },
            });
        }
        catch { }
    }
    return { allowed: result.allowed, reason: result.reason };
}
export async function onPostToolUse(ctx, event) {
    try {
        logAudit({
            process: ctx.processType,
            event_type: "tool_used",
            actor: ctx.actor,
            target: event.toolName,
            detail: { sessionId: ctx.sessionId, incidentId: ctx.incidentId },
        });
    }
    catch {
        /* best-effort */
    }
}
export async function onSessionStart(ctx) {
    try {
        logAudit({
            process: ctx.processType,
            event_type: "session_start",
            actor: ctx.actor,
            detail: { sessionId: ctx.sessionId, incidentId: ctx.incidentId },
        });
    }
    catch { }
    // If this is an incident-linked session, inject incident context
    if (ctx.incidentId) {
        const incident = getIncident(ctx.incidentId);
        if (incident) {
            return {
                injectedContext: `Active incident: ${incident.title} (${incident.severity}, ${incident.status})`,
            };
        }
    }
    return {};
}
export async function onSessionEnd(ctx) {
    try {
        logAudit({
            process: ctx.processType,
            event_type: "session_end",
            actor: ctx.actor,
            detail: { sessionId: ctx.sessionId },
        });
    }
    catch { }
}
export async function onErrorOccurred(ctx, error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
        logAudit({
            process: ctx.processType,
            event_type: "session_error",
            actor: ctx.actor,
            detail: { sessionId: ctx.sessionId, error: message },
        });
    }
    catch { }
    // Retry transient errors (network, timeout)
    const transient = message.includes("ECONNRESET") ||
        message.includes("ETIMEDOUT") ||
        message.includes("rate limit");
    return { retry: transient };
}
