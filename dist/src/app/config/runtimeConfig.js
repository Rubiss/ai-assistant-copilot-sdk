import fs from "fs";
import { resolve } from "path";
import { CONFIG_DIR } from "./env.js";
import { validateRuntimeConfig } from "./validate.js";
const DEFAULT_CONFIG = {
    plugins: {
        "chat-core": { enabled: true },
        "sre-docker-host": { enabled: false },
    },
};
export function loadRuntimeConfig() {
    const configPath = resolve(CONFIG_DIR, "config.json");
    if (!fs.existsSync(configPath)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
        return structuredClone(DEFAULT_CONFIG);
    }
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
    catch (err) {
        console.error(`[config] Failed to parse ${configPath}: ${err instanceof Error ? err.message : err}`);
        console.error("[config] Using default configuration. Fix config.json and restart.");
        return structuredClone(DEFAULT_CONFIG);
    }
    const validated = validateRuntimeConfig(raw);
    // Merge: ensure every default plugin exists in the loaded config
    const merged = {
        plugins: { ...DEFAULT_CONFIG.plugins, ...validated.plugins },
    };
    return merged;
}
