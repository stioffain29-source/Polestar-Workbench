// Shared OpenAI client configuration for ingest + api-server AI features.
//
// Replit auto-provisions AI_INTEGRATIONS_OPENAI_* when the OpenAI integration is
// added. For local dev (e.g. Windows), set OPENAI_API_KEY in .env.local — the
// public OpenAI API base is used by default.

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiConfig {
  baseUrl: string;
  apiKey: string;
}

/** Resolved OpenAI endpoint + key, or null when no integration is configured. */
export function readOpenAiConfig(): OpenAiConfig | null {
  const replitBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
  const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
  if (replitBase && replitKey) {
    return { baseUrl: replitBase.replace(/\/$/, ""), apiKey: replitKey };
  }

  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) {
    const base = (process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
    return { baseUrl: base, apiKey: key };
  }

  return null;
}

/** True when either the Replit integration or a direct OPENAI_API_KEY is present. */
export function isLlmAvailable(): boolean {
  return readOpenAiConfig() !== null;
}

/** Model for country-report prose (cached; quality-first). */
export function openAiProseModel(): string {
  return process.env.OPENAI_PROSE_MODEL?.trim() || "gpt-5.4";
}

/** Model for translation / screening (high volume, lower cost). */
export function openAiFastModel(): string {
  return process.env.OPENAI_FAST_MODEL?.trim() || "gpt-5-mini";
}

/** Env var names surfaced on Source Health (primary + local-dev fallback). */
export const OPENAI_ENV_VARS = [
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
] as const;
