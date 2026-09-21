import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { openAiProseModel, readOpenAiConfig } from "@workspace/ingest";
import type { z } from "zod";
import { logger } from "./logger";

/** Sequential, bounded calls; never replace a failed editorial pass with scraped copy. */
export async function regionalJson<T extends z.ZodTypeAny>(
  schema: T,
  instruction: string,
  input: unknown,
): Promise<z.output<T>> {
  const config = readOpenAiConfig();
  if (!config) throw new Error("Regional analysis requires the configured AI service; no report was changed.");
  const model = openAiProseModel();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: 90_000,
    maxRetries: 1,
  });
  try {
    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: 8192,
      ...(/^gpt-5/.test(model) ? { reasoning_effort: "low" as const } : {}),
      response_format: zodResponseFormat(schema, "regional_editorial"),
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: JSON.stringify(input) },
      ],
    });
    const choice = response.choices[0];
    if (choice?.finish_reason !== "stop" || !choice.message.content || choice.message.refusal) {
      throw new Error("The regional analysis response was incomplete.");
    }
    return schema.parse(JSON.parse(choice.message.content));
  } catch (error) {
    // SDK errors can carry request headers; log neither the error object nor config.
    logger.warn({ model, errorType: error instanceof Error ? error.name : "unknown" }, "Regional editorial call failed");
    throw new Error("The regional analysis service did not return a complete valid result. No report was changed; retry the refresh.");
  }
}