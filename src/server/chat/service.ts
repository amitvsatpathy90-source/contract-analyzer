import {
  generateModelAnswer,
  streamModelAnswer,
  type ModelAnswer,
} from "@/server/ai/client";
import {
  retrieveChunks,
  type RetrievedChunk,
} from "@/server/documents/retrieval";
import {
  verifyEvidence,
  type EvidenceMatch,
} from "@/server/documents/evidence";
import { z } from "zod";

import {
  saveAssistantMessage,
  saveUserMessage,
} from "./history";

export interface ChatCitation {
  documentId: string;
  quote: string;
  verified: true;
  matches: EvidenceMatch[];
}

export interface ChatResult {
  answer: string;
  citations: ChatCitation[];
}

export type ChatStreamEvent =
  | { type: "status"; status: string }
  | { type: "answer_delta"; delta: string }
  | { type: "citations"; citations: ChatCitation[] }
  | { type: "done" }
  | { type: "error"; message: string };

type ModelAnswerGenerator = (input: {
  question: string;
  chunks: RetrievedChunk[];
  signal?: AbortSignal;
}) => Promise<ModelAnswer>;

const NO_SUPPORT_ANSWER =
  "I couldn't find support for an answer in the relevant document passages.";

export async function answerQuestion(
  documentId: string,
  question: string,
  generateAnswer: ModelAnswerGenerator = generateModelAnswer,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const retrieval = await retrieveChunks({
    documentIds: [documentId],
    query: question,
  });

  if (retrieval.chunks.length === 0) {
    return {
      answer: NO_SUPPORT_ANSWER,
      citations: [],
    };
  }

  const modelAnswer = await generateAnswer({
    question,
    chunks: retrieval.chunks,
    signal,
  });

  const citations: ChatCitation[] = [];
  const seenQuotes = new Set<string>();

  for (const quote of modelAnswer.quotes) {
    const trimmedQuote = quote.trim();

    if (!trimmedQuote || seenQuotes.has(trimmedQuote)) {
      continue;
    }

    const verification = await verifyEvidence(documentId, trimmedQuote);

    if (!verification.verified) {
      continue;
    }

    seenQuotes.add(trimmedQuote);
    citations.push({
      documentId,
      quote: trimmedQuote,
      verified: true,
      matches: verification.matches,
    });
  }

  if (citations.length === 0) {
    return {
      answer: NO_SUPPORT_ANSWER,
      citations: [],
    };
  }

  return {
    answer: modelAnswer.answer.trim(),
    citations,
  };
}

const streamingClaimSchema = z.object({
  answer: z.string(),
  quote: z.string(),
});

type ModelAnswerStream = (input: {
  question: string;
  chunks: RetrievedChunk[];
  signal?: AbortSignal;
}) => AsyncIterable<string>;

function parseStreamingClaim(line: string) {
  try {
    return streamingClaimSchema.safeParse(JSON.parse(line) as unknown);
  } catch {
    return { success: false as const };
  }
}

export async function* streamAnswerQuestion(
  documentId: string,
  question: string,
  generateAnswer: ModelAnswerStream = streamModelAnswer,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  let partialAnswer = "";
  const citations: ChatCitation[] = [];
  const seenQuotes = new Set<string>();

  try {
    await saveUserMessage(documentId, question);

    yield {
      type: "status",
      status: "Generating answer...",
    };

    const retrieval = await retrieveChunks({
      documentIds: [documentId],
      query: question,
    });

    if (retrieval.chunks.length === 0) {
      partialAnswer = NO_SUPPORT_ANSWER;
      yield { type: "answer_delta", delta: partialAnswer };
      yield { type: "citations", citations: [] };
      yield { type: "done" };
      return;
    }

    let buffer = "";

    const processLine = async (line: string): Promise<string | null> => {
      if (!line.trim()) {
        return null;
      }

      const parsed = parseStreamingClaim(line.trim());

      if (!parsed.success) {
        return null;
      }

      const answer = parsed.data.answer.trim();
      const quote = parsed.data.quote.trim();

      if (!answer || !quote || seenQuotes.has(quote)) {
        return null;
      }

      const verification = await verifyEvidence(documentId, quote);

      if (!verification.verified) {
        return null;
      }

      seenQuotes.add(quote);
      citations.push({
        documentId,
        quote,
        verified: true,
        matches: verification.matches,
      });

      const delta = partialAnswer ? `\n${answer}` : answer;
      partialAnswer += delta;
      return delta;
    };

    for await (const delta of generateAnswer({
      question,
      chunks: retrieval.chunks,
      signal,
    })) {
      if (signal?.aborted) {
        return;
      }

      buffer += delta;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const answerDelta = await processLine(line);

        if (answerDelta) {
          yield { type: "answer_delta", delta: answerDelta };
        }
      }
    }

    if (signal?.aborted) {
      return;
    }

    const finalDelta = await processLine(buffer);

    if (finalDelta) {
      yield { type: "answer_delta", delta: finalDelta };
    }

    if (!partialAnswer) {
      partialAnswer = NO_SUPPORT_ANSWER;
      yield { type: "answer_delta", delta: partialAnswer };
    }

    yield {
      type: "citations",
      citations,
    };
    yield { type: "done" };
  } catch (error) {
    if (signal?.aborted) {
      return;
    }

    console.error("Chat stream failed", { documentId, error });
    yield {
      type: "error",
      message: "The question could not be answered.",
    };
  } finally {
    if (partialAnswer) {
      try {
        await saveAssistantMessage(documentId, partialAnswer, citations);
      } catch (error) {
        console.error("Failed to persist streamed chat answer", {
          documentId,
          error,
        });
      }
    }
  }
}

