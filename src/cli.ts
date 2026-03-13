#!/usr/bin/env node
import { createInterface, type Interface } from "readline";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { resolve, dirname, join } from "path";
import { homedir, tmpdir } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename);

// Config dir: ~/.ai-assistant/ or override via AI_ASSISTANT_CONFIG_DIR
const CONFIG_DIR = process.env.AI_ASSISTANT_CONFIG_DIR
  ? resolve(process.env.AI_ASSISTANT_CONFIG_DIR)
  : resolve(homedir(), ".ai-assistant");
const ENV_FILE = resolve(CONFIG_DIR, ".env");

// Package root = two directories up from dist/src/cli.js
const PACKAGE_ROOT = resolve(__dirname_local, "../..");

// ─── Helpers ───────────────────────────────────────────────────────────────

function question(rl: Interface, prompt: string): Promise<string> {
  return new Promise((res) => rl.question(prompt, res));
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx === -1) continue;
    out[t.slice(0, idx)] = t.slice(idx + 1);
  }
  return out;
}

async function promptVar(
  rl: Interface,
  label: string,
  key: string,
  existing: Record<string, string>,
  required: boolean
): Promise<string> {
  const current = existing[key] ?? "";
  // Mask sensitive values in the hint
  const isSensitive = key.toLowerCase().includes("token");
  const hint = current
    ? ` [${isSensitive ? current.slice(0, 6) + "..." : current}]`
    : "";
  const suffix = required ? "" : " (optional, Enter to skip)";
  const answer = await question(rl, `${label}${hint}${suffix}: `);
  return answer.trim() || current;
}

// ─── Commands ──────────────────────────────────────────────────────────────

async function setup(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = parseEnvFile(ENV_FILE);
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n🤖  AI Assistant Setup");
  console.log(`Config directory: ${CONFIG_DIR}\n`);

  const token = await promptVar(rl, "Discord Bot Token", "DISCORD_TOKEN", existing, true);
  const appId = await promptVar(rl, "Discord Application ID", "DISCORD_APP_ID", existing, true);
  const guildId = await promptVar(
    rl,
    "Discord Guild ID (for slash command registration)",
    "DISCORD_GUILD_ID",
    existing,
    true
  );
  const freeChannels = await promptVar(
    rl,
    "Free channel IDs (comma-separated, bot replies without @mention)",
    "DISCORD_FREE_CHANNELS",
    existing,
    false
  );
  const allowedUsers = await promptVar(
    rl,
    "Allowed user IDs (comma-separated, leave empty to allow all users)",
    "DISCORD_ALLOWED_USERS",
    existing,
    false
  );

  if (!token || !appId || !guildId) {
    console.error("\n❌ DISCORD_TOKEN, DISCORD_APP_ID, and DISCORD_GUILD_ID are required.");
    rl.close();
    process.exit(1);
  }

  const lines = [
    `DISCORD_TOKEN=${token}`,
    `DISCORD_APP_ID=${appId}`,
    `DISCORD_GUILD_ID=${guildId}`,
    freeChannels ? `DISCORD_FREE_CHANNELS=${freeChannels}` : "# DISCORD_FREE_CHANNELS=",
    allowedUsers ? `DISCORD_ALLOWED_USERS=${allowedUsers}` : "# DISCORD_ALLOWED_USERS=",
  ];
  writeFileSync(ENV_FILE, lines.join("\n") + "\n");
  console.log(`\n✅ Config saved to ${ENV_FILE}`);

  const doRegister = await question(rl, "\nRegister Discord slash commands now? [Y/n] ");
  rl.close();

  if (!doRegister.trim() || doRegister.trim().toLowerCase() === "y") {
    console.log("Registering slash commands...");
    process.chdir(CONFIG_DIR);
    await import("../scripts/register-commands.js");
  }

  console.log("\nSetup complete! Next steps:");
  console.log("  ai-assistant start            # start the bot");
  console.log("  ai-assistant install-service  # optional: run as a systemd service");
}

async function start(): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    console.error(`❌ Config not found at ${ENV_FILE}\nRun: ai-assistant setup`);
    process.exit(1);
  }
  // chdir so dotenv.config() in index.ts picks up the right .env
  process.chdir(CONFIG_DIR);
  await import("./index.js");
}

async function register(): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    console.error(`❌ Config not found at ${ENV_FILE}\nRun: ai-assistant setup`);
    process.exit(1);
  }
  process.chdir(CONFIG_DIR);
  await import("../scripts/register-commands.js");
}

async function installService(): Promise<void> {
  const templatePath = resolve(PACKAGE_ROOT, "ai-assistant.service");
  if (!existsSync(templatePath)) {
    console.error(`❌ Service template not found at ${templatePath}`);
    process.exit(1);
  }

  // Prefer SUDO_USER so service runs as the calling user, not as root
  const user = process.env.SUDO_USER ?? process.env.USER ?? "root";
  if (user === "root") {
    console.warn("⚠️  Installing service to run as root. Run as a non-root user or set SUDO_USER.");
  }
  const nodePath = process.execPath;
  const cliPath = resolve(__dirname_local, "cli.js");

  const patched = readFileSync(templatePath, "utf-8")
    .replace(/%%USER%%/g, user)
    .replace(/%%CONFIG_DIR%%/g, CONFIG_DIR)
    .replace(/%%NODE_PATH%%/g, nodePath)
    .replace(/%%CLI_PATH%%/g, cliPath);

  // Write to a unique temp dir (not predictable /tmp path) to avoid TOCTOU before sudo cp
  const tmpDir = mkdtempSync(join(tmpdir(), "ai-assistant-"));
  const tmpPath = join(tmpDir, "ai-assistant.service");
  writeFileSync(tmpPath, patched, { mode: 0o600 });

  console.log("Installing /etc/systemd/system/ai-assistant.service ...");

  const cp = spawnSync("sudo", ["cp", tmpPath, "/etc/systemd/system/ai-assistant.service"], {
    stdio: "inherit",
  });
  rmSync(tmpDir, { recursive: true, force: true });
  if (cp.status !== 0) {
    console.error("❌ Failed to copy service file (sudo cp failed).");
    process.exit(1);
  }

  const reload = spawnSync("sudo", ["systemctl", "daemon-reload"], { stdio: "inherit" });
  if (reload.status !== 0) {
    console.error("❌ systemctl daemon-reload failed.");
    process.exit(1);
  }

  const enable = spawnSync("sudo", ["systemctl", "enable", "ai-assistant"], { stdio: "inherit" });
  if (enable.status !== 0) {
    console.error("❌ systemctl enable failed.");
    process.exit(1);
  }

  console.log("\n✅ Service installed and enabled.");
  console.log("  sudo systemctl start ai-assistant   # start now");
  console.log("  sudo systemctl restart ai-assistant # restart after update");
  console.log("  sudo journalctl -u ai-assistant -f  # view logs");
}

function update(): void {
  console.log("To update to the latest version:");
  console.log("  npm install -g --install-links github:Rubiss/ai-assistant-copilot-sdk");
  console.log("\nTo pin a specific version:");
  console.log("  npm install -g --install-links github:Rubiss/ai-assistant-copilot-sdk#v1.0.0");
}

function help(): void {
  console.log("Usage: ai-assistant <command>\n");
  console.log("Commands:");
  console.log("  setup            Interactive setup wizard — creates ~/.ai-assistant/.env");
  console.log("  start            Start the bot");
  console.log("  register         Register Discord slash commands with the Discord API");
  console.log("  install-service  Install and enable as a systemd service");
  console.log("  update           Print update instructions");
  console.log("\nEnvironment:");
  console.log("  AI_ASSISTANT_CONFIG_DIR  Override config directory (default: ~/.ai-assistant)");
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

const cmd = process.argv[2];

switch (cmd) {
  case "setup":
    await setup();
    break;
  case "start":
    await start();
    break;
  case "register":
    await register();
    break;
  case "install-service":
    await installService();
    break;
  case "update":
    update();
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  default:
    help();
    if (cmd !== undefined) process.exit(1);
}
