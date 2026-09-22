import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { openAiProseModel, readOpenAiConfig } from "@workspace/ingest";
import type { z } from "zod";
import { logger } from "./logger";

export function dbPortsAiConfigured(): boolean {
  return !!readOpenAiConfig();
}

/** Bounded JSON drafting for the ports report. A failed call never falls back
 * to scraped copy: the item stays undrafted and the analyst is told. */
export async function dbPortsJson<T extends z.ZodTypeAny>(
  schema: T,
  schemaName: string,
  instruction: string,
  input: unknown,
): Promise<z.output<T>> {
  const config = readOpenAiConfig();
  if (!config) {
    throw new Error("Draft generation requires the configured AI service; nothing was written.");
  }
  const model = openAiProseModel();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: 120_000,
    maxRetries: 1,
  });
  try {
    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: 8192,
      ...(/^gpt-5/.test(model) ? { reasoning_effort: "low" as const } : {}),
      response_format: zodResponseFormat(schema, schemaName),
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: JSON.stringify(input) },
      ],
    });
    const choice = response.choices[0];
    if (choice?.finish_reason !== "stop" || !choice.message.content || choice.message.refusal) {
      throw new Error("The drafting response was incomplete.");
    }
    return schema.parse(JSON.parse(choice.message.content));
  } catch (error) {
    // SDK errors can carry request headers; log neither the error object nor config.
    logger.warn(
      { model, schemaName, errorType: error instanceof Error ? error.name : "unknown" },
      "DB Ports drafting call failed",
    );
    throw new Error("The drafting service did not return a complete valid result. Nothing was written; retry.");
  }
}
