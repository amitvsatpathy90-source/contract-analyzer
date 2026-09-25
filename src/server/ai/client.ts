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
  signal?: AbortSignal;
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

export async function* streamModelAnswer({
  question,
  chunks,
  signal,
}: ModelAnswerInput): AsyncGenerator<string> {
  const context = chunks
    .map(
      (chunk, index) =>
        `[Passage ${index + 1}]\n${chunk.text}`,
    )
    .join("\n\n");

  const stream = await getClient().chat.completions.create(
    {
      model: getModel(),
      messages: [
        {
          role: "system",
          content:
            "Answer the user's question using only the supplied contract passages. " +
            "Stream newline-delimited JSON objects only. Each object must contain " +
            "an answer field with one supported answer sentence or clause and a " +
            "quote field containing the exact verbatim source text that supports it. " +
            "Do not emit markdown, code fences, commentary, page numbers, offsets, " +
            "or invented source locations. The quote may contain escaped newlines " +
            "inside the JSON string. Emit each complete answer/quote pair as one JSON " +
            "object on its own line. If the passages do not support an answer, emit " +
            "one object with the support message as answer and an empty quote.",
        },
        {
          role: "user",
          content: `Question:\n${question}\n\nContract passages:\n${context}`,
        },
      ],
      stream: true,
    },
    { signal },
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;

    if (delta) {
      yield delta;
    }
  }
}

export async function generateModelAnswer({
  question,
  chunks,
  signal,
}: ModelAnswerInput): Promise<ModelAnswer> {
  const context = chunks
    .map(
      (chunk, index) =>
        `[Passage ${index + 1}]\n${chunk.text}`,
    )
    .join("\n\n");

  const response = await getClient().chat.completions.parse(
    {
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
    },
    { signal },
  );

  const parsed = response.choices[0]?.message.parsed;

  if (!parsed) {
    throw new Error("The AI response did not contain a structured answer.");
  }

  return parsed;
}

