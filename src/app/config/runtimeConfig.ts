import fs from "fs";
import { resolve } from "path";
import { CONFIG_DIR } from "./env.js";
import { validateRuntimeConfig } from "./validate.js";

export interface PluginConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface RuntimeConfig {
  plugins: Record<string, PluginConfig>;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  plugins: {
    "chat-core": { enabled: true },
    "sre-docker-host": { enabled: false },
  },
};

export function loadRuntimeConfig(): RuntimeConfig {
  const configPath = resolve(CONFIG_DIR, "config.json");

  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    return structuredClone(DEFAULT_CONFIG);
  }

  const raw: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const validated = validateRuntimeConfig(raw);

  // Merge: ensure every default plugin exists in the loaded config
  const merged: RuntimeConfig = {
    plugins: { ...DEFAULT_CONFIG.plugins, ...validated.plugins },
  };

  return merged;
}
