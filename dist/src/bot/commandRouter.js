import { logAudit } from "../app/store/audit.js";
export class CommandRouter {
    handlers = new Map();
    register(name, handler) {
        this.handlers.set(name, handler);
    }
    async dispatch(interaction, context) {
        const handler = this.handlers.get(interaction.commandName);
        if (handler) {
            try {
                await handler(interaction, context);
                try {
                    logAudit({ process: "bot", event_type: "command", actor: `user:${interaction.user.id}`, target: interaction.commandName });
                }
                catch { /* audit is best-effort */ }
            }
            catch (err) {
                try {
                    logAudit({ process: "bot", event_type: "command_error", actor: `user:${interaction.user.id}`, target: interaction.commandName, detail: { error: err instanceof Error ? err.message : String(err) } });
                }
                catch { /* audit is best-effort */ }
                throw err;
            }
        }
        else {
            console.warn(`Unknown command: ${interaction.commandName}`);
        }
    }
}
