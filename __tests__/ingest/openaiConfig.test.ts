import {
  isLlmAvailable,
  readOpenAiConfig,
  openAiProseModel,
  openAiFastModel,
} from "../../lib/ingest/src/openaiConfig";

const savedEnv = { ...process.env };

describe("openaiConfig", () => {
  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_PROSE_MODEL;
    delete process.env.OPENAI_FAST_MODEL;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("returns null when no OpenAI env is set", () => {
    expect(readOpenAiConfig()).toBeNull();
    expect(isLlmAvailable()).toBe(false);
  });

  it("prefers the Replit integration vars when both are present", () => {
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://replit.example/v1/";
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "replit-key";
    process.env.OPENAI_API_KEY = "direct-key";
    expect(readOpenAiConfig()).toEqual({
      baseUrl: "https://replit.example/v1",
      apiKey: "replit-key",
    });
  });

  it("falls back to OPENAI_API_KEY with the public API base", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(readOpenAiConfig()).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });
  });

  it("honours OPENAI_BASE_URL for the direct-key path", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = "https://proxy.example/v1/";
    expect(readOpenAiConfig()?.baseUrl).toBe("https://proxy.example/v1");
  });

  it("exposes default model names with optional overrides", () => {
    expect(openAiProseModel()).toBe("gpt-5.4");
    expect(openAiFastModel()).toBe("gpt-5-mini");
    process.env.OPENAI_PROSE_MODEL = "gpt-4o";
    process.env.OPENAI_FAST_MODEL = "gpt-4o-mini";
    expect(openAiProseModel()).toBe("gpt-4o");
    expect(openAiFastModel()).toBe("gpt-4o-mini");
  });
});
