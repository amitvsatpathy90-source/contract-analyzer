import {
  generateModelAnswer,
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

type ModelAnswerGenerator = (input: {
  question: string;
  chunks: RetrievedChunk[];
}) => Promise<ModelAnswer>;

const NO_SUPPORT_ANSWER =
  "I couldn't find support for an answer in the relevant document passages.";

export async function answerQuestion(
  documentId: string,
  question: string,
  generateAnswer: ModelAnswerGenerator = generateModelAnswer,
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

