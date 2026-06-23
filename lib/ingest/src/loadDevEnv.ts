import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Dev-only bootstrap for operator secrets that Replit injects via userenv.shared
// in the cloud but that are absent when running locally (e.g. on Windows). Never
// overrides an env var that is already set.
//
// Lookup order:
//   1. .env.local at the workspace root (gitignored; copy from .env.local.example)
//   2. [userenv.shared] in .replit (same source Replit uses in the Repl)

function workspaceRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

function applyKeyValueLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (key && process.env[key] === undefined) {
    process.env[key] = value;
  }
}

function loadDotEnvLocal(root: string): void {
  const path = resolve(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    applyKeyValueLine(line);
  }
}

function loadReplitSharedUserEnv(root: string): void {
  const path = resolve(root, ".replit");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  const sharedMatch = content.match(/\[userenv\.shared\]([\s\S]*?)(?:\n\[|$)/);
  if (!sharedMatch) return;
  for (const line of sharedMatch[1].split(/\r?\n/)) {
    applyKeyValueLine(line);
  }
}

export function loadDevEnv(): void {
  if (process.env.NODE_ENV === "production") return;
  const root = workspaceRoot();
  loadDotEnvLocal(root);
  loadReplitSharedUserEnv(root);
}
