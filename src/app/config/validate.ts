import type { RuntimeConfig, PluginConfig } from "./runtimeConfig.js";

export function validateRuntimeConfig(raw: unknown): RuntimeConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("config must be a non-null object");
  }

  const obj = raw as Record<string, unknown>;

  if (
    obj.plugins === null ||
    typeof obj.plugins !== "object" ||
    Array.isArray(obj.plugins)
  ) {
    throw new Error("config.plugins must be an object");
  }

  const plugins = obj.plugins as Record<string, unknown>;

  for (const [name, entry] of Object.entries(plugins)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`config.plugins["${name}"] must be an object`);
    }
    const pluginEntry = entry as Record<string, unknown>;
    if (typeof pluginEntry.enabled !== "boolean") {
      throw new Error(
        `config.plugins["${name}"].enabled must be a boolean`,
      );
    }
  }

  return { plugins: plugins as Record<string, PluginConfig> };
}
