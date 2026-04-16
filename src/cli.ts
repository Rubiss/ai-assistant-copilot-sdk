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
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");

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

function loadConfigFile(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
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

  // ── Discord credentials ──
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

  // ── SRE automation setup ──
  const config = loadConfigFile();
  const plugins = (config.plugins ?? {}) as Record<string, Record<string, unknown>>;

  if (!plugins["chat-core"]) {
    plugins["chat-core"] = { enabled: true };
  }

  const enableSre = await question(
    rl,
    "\nEnable SRE automation (Docker monitoring, webhooks, incident management)? [y/N] "
  );

  if (enableSre.trim().toLowerCase() === "y") {
    console.log("\n📦  SRE Automation Setup\n");

    const defaultWorkspace = resolve(homedir(), "docker");
    const existingSre = (plugins["sre-docker-host"] ?? {}) as Record<string, unknown>;

    const workspaceHint = (existingSre.workspacePath as string) ?? defaultWorkspace;
    const workspaceAnswer = await question(
      rl,
      `Workspace path (docker-compose files) [${workspaceHint}]: `
    );
    const workspacePath = workspaceAnswer.trim() || workspaceHint;

    const portHint = (existingSre.webhookPort as number) ?? 8780;
    const portAnswer = await question(rl, `Webhook port [${portHint}]: `);
    const webhookPort = parseInt(portAnswer.trim(), 10) || portHint;

    const alertHint = (existingSre.alertChannelId as string) ?? "";
    const alertAnswer = await question(
      rl,
      `Alert channel ID (Discord channel for incident notifications)${alertHint ? ` [${alertHint}]` : ""}: `
    );
    const alertChannelId = alertAnswer.trim() || alertHint;

    if (!alertChannelId) {
      console.warn("⚠️  No alert channel ID provided — incidents won't post to Discord.");
    }

    const escalationHint = (existingSre.escalationChannelId as string) ?? "";
    const escalationAnswer = await question(
      rl,
      `Escalation channel ID${escalationHint ? ` [${escalationHint}]` : ""} (optional, Enter to skip): `
    );
    const escalationChannelId = escalationAnswer.trim() || escalationHint;

    const sreConfig: Record<string, unknown> = {
      enabled: true,
      workspacePath,
      webhookPort,
      alertChannelId,
    };
    if (escalationChannelId) {
      sreConfig.escalationChannelId = escalationChannelId;
    }
    plugins["sre-docker-host"] = sreConfig;

    console.log("\n✅ SRE automation configured.");
  } else {
    // Preserve existing sre-docker-host config if present, otherwise set disabled default
    if (!plugins["sre-docker-host"]) {
      plugins["sre-docker-host"] = { enabled: false };
    }
  }

  config.plugins = plugins;
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
  console.log(`✅ Plugin config saved to ${CONFIG_FILE}`);

  // ── Register slash commands ──
  const doRegister = await question(rl, "\nRegister Discord slash commands now? [Y/n] ");
  rl.close();

  if (!doRegister.trim() || doRegister.trim().toLowerCase() === "y") {
    console.log("Registering slash commands...");
    process.chdir(CONFIG_DIR);
    await import("../scripts/register-commands.js");
  }

  console.log("\nSetup complete! Next steps:");
  console.log("  ai-assistant start            # start the bot");
  console.log("  ai-assistant start-all        # start bot + worker (SRE automation)");
  console.log("  ai-assistant install-service  # optional: run as systemd services");
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

async function deployCommands(): Promise<void> {
  return register();
}

async function installService(): Promise<void> {
  // Prefer SUDO_USER so service runs as the calling user, not as root
  const user = process.env.SUDO_USER ?? process.env.USER ?? "root";
  if (user === "root") {
    console.warn("⚠️  Installing service to run as root. Run as a non-root user or set SUDO_USER.");
  }
  const nodePath = process.execPath;
  const cliPath = resolve(__dirname_local, "cli.js");

  const serviceFiles = [
    { template: "ai-assistant-bot.service", dest: "ai-assistant-bot.service" },
    { template: "ai-assistant-worker.service", dest: "ai-assistant-worker.service" },
    { template: "ai-assistant.service", dest: "ai-assistant.service" },
  ];

  for (const { template, dest } of serviceFiles) {
    const templatePath = resolve(PACKAGE_ROOT, template);
    if (!existsSync(templatePath)) {
      console.warn(`⚠️  Template not found: ${templatePath} — skipping ${dest}`);
      continue;
    }

    const patched = readFileSync(templatePath, "utf-8")
      .replace(/%%USER%%/g, user)
      .replace(/%%CONFIG_DIR%%/g, CONFIG_DIR)
      .replace(/%%NODE_PATH%%/g, nodePath)
      .replace(/%%CLI_PATH%%/g, cliPath);

    // Write to a unique temp dir (not predictable /tmp path) to avoid TOCTOU before sudo cp
    const tmpDir = mkdtempSync(join(tmpdir(), "ai-assistant-"));
    const tmpPath = join(tmpDir, dest);
    writeFileSync(tmpPath, patched, { mode: 0o600 });

    console.log(`Installing /etc/systemd/system/${dest} ...`);

    const cp = spawnSync("sudo", ["cp", tmpPath, `/etc/systemd/system/${dest}`], {
      stdio: "inherit",
    });
    rmSync(tmpDir, { recursive: true, force: true });
    if (cp.status !== 0) {
      console.error(`❌ Failed to copy ${dest} (sudo cp failed).`);
      process.exit(1);
    }
  }

  const reload = spawnSync("sudo", ["systemctl", "daemon-reload"], { stdio: "inherit" });
  if (reload.status !== 0) {
    console.error("❌ systemctl daemon-reload failed.");
    process.exit(1);
  }

  const enableBot = spawnSync("sudo", ["systemctl", "enable", "ai-assistant-bot"], { stdio: "inherit" });
  if (enableBot.status !== 0) {
    console.error("❌ systemctl enable ai-assistant-bot failed.");
    process.exit(1);
  }

  const enableWorker = spawnSync("sudo", ["systemctl", "enable", "ai-assistant-worker"], { stdio: "inherit" });
  if (enableWorker.status !== 0) {
    console.error("❌ systemctl enable ai-assistant-worker failed.");
    process.exit(1);
  }

  // Also enable legacy service for backward compatibility
  spawnSync("sudo", ["systemctl", "enable", "ai-assistant"], { stdio: "inherit" });

  console.log("\n✅ Services installed and enabled.");
  console.log("  sudo systemctl start ai-assistant-bot       # start bot");
  console.log("  sudo systemctl start ai-assistant-worker    # start worker");
  console.log("  sudo systemctl restart ai-assistant-bot     # restart after update");
  console.log("  sudo journalctl -u ai-assistant-bot -f      # bot logs");
  console.log("  sudo journalctl -u ai-assistant-worker -f   # worker logs");
}

async function startBotCmd(): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    console.error(`❌ Config not found at ${ENV_FILE}\nRun: ai-assistant setup`);
    process.exit(1);
  }
  process.chdir(CONFIG_DIR);
  const { startBot } = await import("./bot/index.js");
  await startBot();
}

async function startWorkerCmd(): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    console.error(`❌ Config not found at ${ENV_FILE}\nRun: ai-assistant setup`);
    process.exit(1);
  }
  process.chdir(CONFIG_DIR);
  const { startWorker } = await import("./worker/index.js");
  await startWorker();
}

async function startAllCmd(): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    console.error(`❌ Config not found at ${ENV_FILE}\nRun: ai-assistant setup`);
    process.exit(1);
  }
  process.chdir(CONFIG_DIR);
  const { startBot } = await import("./bot/index.js");
  const { startWorker } = await import("./worker/index.js");
  // Start both concurrently — both are long-running, await keeps process alive
  await Promise.all([startWorker(), startBot()]);
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
  console.log("  setup             Interactive setup wizard — creates ~/.ai-assistant/.env and config.json");
  console.log("  start             Start the bot (backward-compatible alias for start-bot)");
  console.log("  start-bot         Start the bot process (Discord gateway, slash commands)");
  console.log("  start-worker      Start the worker process (webhooks, scheduler, Docker monitor)");
  console.log("  start-all         Start both bot and worker processes");
  console.log("  deploy-commands   Register Discord slash commands with the Discord API");
  console.log("  register          Alias for deploy-commands");
  console.log("  install-service   Install and enable systemd services (bot + worker)");
  console.log("  update            Print update instructions");
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
  case "start-bot":
    await startBotCmd();
    break;
  case "start-worker":
    await startWorkerCmd();
    break;
  case "start-all":
    await startAllCmd();
    break;
  case "deploy-commands":
    await deployCommands();
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
