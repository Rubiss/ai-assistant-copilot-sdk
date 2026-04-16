import dotenv from "dotenv";
import { resolve } from "path";
import { homedir } from "os";

export const CONFIG_DIR: string = process.env.AI_ASSISTANT_CONFIG_DIR
  ? resolve(process.env.AI_ASSISTANT_CONFIG_DIR)
  : resolve(homedir(), ".ai-assistant");

export function env(key: string, required?: boolean): string | undefined {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

type ProcessType = "bot" | "worker" | "all";

const REQUIRED_VARS: Record<ProcessType, string[]> = {
  bot: ["DISCORD_TOKEN", "DISCORD_APP_ID", "DISCORD_GUILD_ID"],
  worker: [],
  all: ["DISCORD_TOKEN", "DISCORD_APP_ID", "DISCORD_GUILD_ID"],
};

export function loadEnv(processType: ProcessType = "all"): void {
  dotenv.config({ path: resolve(CONFIG_DIR, ".env") });

  for (const key of REQUIRED_VARS[processType]) {
    env(key, true);
  }
}
