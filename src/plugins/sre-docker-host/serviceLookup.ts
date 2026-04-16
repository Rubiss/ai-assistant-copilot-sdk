import fs from "node:fs";
import { resolve, join } from "node:path";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ServiceDefinition {
  name: string;
  image?: string;
  ports?: string[];
  volumes?: string[];
  depends_on?: string[];
  environment?: Record<string, string>;
  labels?: Record<string, string>;
  composeFile: string;
}

/* ------------------------------------------------------------------ */
/*  Basic YAML parser for docker-compose files                         */
/* ------------------------------------------------------------------ */

/**
 * Minimal line-based parser that handles common docker-compose patterns.
 * Extracts service names and their image, ports, volumes, depends_on,
 * environment, and labels fields.
 */
export function parseComposeServices(
  content: string,
  filePath: string,
): ServiceDefinition[] {
  const lines = content.split("\n");
  const services: ServiceDefinition[] = [];

  let inServices = false;
  let currentService: ServiceDefinition | null = null;
  let currentKey: string | null = null;
  let serviceIndent = -1;
  let keyIndent = -1;

  for (const rawLine of lines) {
    // Skip comments and empty lines
    if (rawLine.trim().startsWith("#") || rawLine.trim() === "") continue;

    const indent = rawLine.length - rawLine.trimStart().length;
    const trimmed = rawLine.trim();

    // Detect top-level "services:" key
    if (indent === 0 && trimmed === "services:") {
      inServices = true;
      currentService = null;
      currentKey = null;
      continue;
    }

    // Another top-level key ends the services block
    if (indent === 0 && trimmed.endsWith(":") && trimmed !== "services:") {
      inServices = false;
      if (currentService) services.push(currentService);
      currentService = null;
      currentKey = null;
      continue;
    }

    if (!inServices) continue;

    // Service name line (first level under services, key ending with ":")
    if (
      serviceIndent === -1 ||
      (indent <= serviceIndent && trimmed.endsWith(":") && !trimmed.startsWith("-"))
    ) {
      if (
        indent > 0 &&
        trimmed.endsWith(":") &&
        !trimmed.startsWith("-")
      ) {
        if (currentService) services.push(currentService);
        serviceIndent = indent;
        currentService = {
          name: trimmed.slice(0, -1).trim(),
          composeFile: filePath,
        };
        currentKey = null;
        keyIndent = -1;
        continue;
      }
    }

    if (!currentService) continue;

    // Property lines within a service
    if (indent > serviceIndent) {
      // Key-value pair (e.g., "image: nginx")
      const kvMatch = trimmed.match(/^([a-z_]+)\s*:\s*(.+)$/);
      if (kvMatch && !trimmed.startsWith("-")) {
        const [, key, value] = kvMatch;
        currentKey = key!;
        keyIndent = indent;
        const cleanValue = value!.trim().replace(/^["']|["']$/g, "");

        switch (key) {
          case "image":
            currentService.image = cleanValue;
            break;
          case "container_name":
            currentService.name = cleanValue;
            break;
        }
        continue;
      }

      // Key with no value (start of list/block, e.g., "ports:")
      const blockMatch = trimmed.match(/^([a-z_]+)\s*:$/);
      if (blockMatch && !trimmed.startsWith("-")) {
        currentKey = blockMatch[1]!;
        keyIndent = indent;
        continue;
      }

      // List item (e.g., "- '8080:80'")
      if (trimmed.startsWith("-") && currentKey && indent > keyIndent) {
        const item = trimmed.slice(1).trim().replace(/^["']|["']$/g, "");

        switch (currentKey) {
          case "ports":
            (currentService.ports ??= []).push(item);
            break;
          case "volumes":
            (currentService.volumes ??= []).push(item);
            break;
          case "depends_on":
            (currentService.depends_on ??= []).push(item);
            break;
        }
        continue;
      }

      // Environment / labels as key: value under their block
      if (currentKey === "environment" || currentKey === "labels") {
        // "KEY: value" style
        const envKv = trimmed.match(/^([^:]+):\s*(.*)$/);
        if (envKv && !trimmed.startsWith("-") && indent > keyIndent) {
          const envKey = envKv[1]!.trim().replace(/^["']|["']$/g, "");
          const envVal = envKv[2]!.trim().replace(/^["']|["']$/g, "");
          if (currentKey === "environment") {
            (currentService.environment ??= {})[envKey] = envVal;
          } else {
            (currentService.labels ??= {})[envKey] = envVal;
          }
          continue;
        }

        // "- KEY=value" style (environment only)
        if (trimmed.startsWith("-") && currentKey === "environment") {
          const item = trimmed.slice(1).trim().replace(/^["']|["']$/g, "");
          const eqIdx = item.indexOf("=");
          if (eqIdx > 0) {
            (currentService.environment ??= {})[item.slice(0, eqIdx)] =
              item.slice(eqIdx + 1);
          }
          continue;
        }

        // "- KEY=value" style (labels)
        if (trimmed.startsWith("-") && currentKey === "labels") {
          const item = trimmed.slice(1).trim().replace(/^["']|["']$/g, "");
          const eqIdx = item.indexOf("=");
          if (eqIdx > 0) {
            (currentService.labels ??= {})[item.slice(0, eqIdx)] =
              item.slice(eqIdx + 1);
          }
          continue;
        }
      }
    }

    // If we hit a line at service-level indent that doesn't end with ":", we may
    // have left the services section (e.g., another top-level key without a colon
    // in a weird format). Safe to ignore.
  }

  // Push last service
  if (currentService) services.push(currentService);

  return services;
}

/* ------------------------------------------------------------------ */
/*  Service discovery                                                  */
/* ------------------------------------------------------------------ */

const COMPOSE_FILES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

export function discoverServices(workspacePath: string): ServiceDefinition[] {
  const services: ServiceDefinition[] = [];

  // Search workspace path for compose files
  for (const file of COMPOSE_FILES) {
    const fullPath = resolve(workspacePath, file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      services.push(...parseComposeServices(content, fullPath));
    }
  }

  // Also check immediate subdirectories
  try {
    for (const dir of fs.readdirSync(workspacePath, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const file of COMPOSE_FILES) {
        const fullPath = join(workspacePath, dir.name, file);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          services.push(...parseComposeServices(content, fullPath));
        }
      }
    }
  } catch {
    /* workspace might not exist */
  }

  return services;
}

export function findServiceByContainer(
  services: ServiceDefinition[],
  containerName: string,
): ServiceDefinition | undefined {
  return services.find(
    (s) => s.name === containerName || containerName.includes(s.name),
  );
}
