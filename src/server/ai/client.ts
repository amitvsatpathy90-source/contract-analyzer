import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

import type { RetrievedChunk } from "@/server/documents/retrieval";

const modelAnswerSchema = z.object({
  answer: z.string(),
  quotes: z.array(z.string()),
});

export interface ModelAnswerInput {
  question: string;
  chunks: RetrievedChunk[];
}

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (client) {
    return client;
  }

  const apiKey = process.env.AI_API_KEY;
  const baseURL = process.env.AI_BASE_URL || undefined;

  if (!apiKey) {
    throw new Error("AI_API_KEY is required.");
  }

  client = new OpenAI({
    apiKey,
    baseURL,
  });

  return client;
}

function getModel(): string {
  const model = process.env.AI_MODEL;

  if (!model) {
    throw new Error("AI_MODEL is required.");
  }

  return model;
}

export async function generateModelAnswer({
  question,
  chunks,
}: ModelAnswerInput): Promise<ModelAnswer> {
  const context = chunks
    .map(
      (chunk, index) =>
        `[Passage ${index + 1}]\n${chunk.text}`,
    )
    .join("\n\n");

  const response = await getClient().chat.completions.parse({
    model: getModel(),
    messages: [
      {
        role: "system",
        content:
          "Answer the user's question using only the supplied contract passages. " +
          "Every factual statement in the answer must be supported by an exact " +
          "quote from those passages. Return the quote text verbatim as it appears " +
          "in the passage. Do not paraphrase quotes. Do not invent quotes, page " +
          "numbers, offsets, or other source locations. If the passages do not " +
          "support the answer, say that you could not find support in the supplied " +
          "document passages and return no quotes.",
      },
      {
        role: "user",
        content: `Question:\n${question}\n\nContract passages:\n${context}`,
      },
    ],
    response_format: zodResponseFormat(modelAnswerSchema, "contract_answer"),
  });

  const parsed = response.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error("The AI response did not contain a structured answer.");
  }

  return parsed;
}

