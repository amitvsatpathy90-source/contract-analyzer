import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/server/db/client";
import { documentChunks, documents } from "@/server/db/schema";

export interface RetrievalOptions {
  documentIds: string[];
  query: string;
  limit?: number;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  tokenEstimate: number;
  score: number;
}

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  scannedChunkCount: number;
  matchedChunkCount: number;
}

const DEFAULT_LIMIT = 8;

function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text).match(/[a-z0-9]+/g) ?? [];
}

function scoreChunk(query: string, queryTokens: string[], text: string): number {
  const normalizedChunk = normalizeText(text);
  const chunkTokens = tokenize(text);

  if (queryTokens.length === 0 || chunkTokens.length === 0) {
    return 0;
  }

  const frequencies = new Map<string, number>();
  for (const token of chunkTokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  const uniqueQueryTokens = [...new Set(queryTokens)];
  let matchedTokens = 0;
  let frequencyScore = 0;

  for (const token of uniqueQueryTokens) {
    const frequency = frequencies.get(token) ?? 0;

    if (frequency > 0) {
      matchedTokens += 1;
      frequencyScore += Math.min(frequency, 3);
    }
  }

  if (matchedTokens === 0) {
    return 0;
  }

  const coverageScore = matchedTokens / uniqueQueryTokens.length;
  const phraseScore =
    normalizedChunk.includes(normalizeText(query)) ? 2 : 0;

  return coverageScore * 10 + frequencyScore + phraseScore;
}

export async function retrieveChunks({
  documentIds,
  query,
  limit = DEFAULT_LIMIT,
}: RetrievalOptions): Promise<RetrievalResult> {
  const normalizedQuery = normalizeText(query);

  if (documentIds.length === 0) {
    throw new Error("At least one document ID is required for retrieval.");
  }

  if (!normalizedQuery) {
    return {
      query,
      chunks: [],
      scannedChunkCount: 0,
      matchedChunkCount: 0,
    };
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("limit must be a positive integer.");
  }

  const rows = await db
    .select({ chunk: documentChunks })
    .from(documentChunks)
    .innerJoin(
      documents,
      eq(documentChunks.documentId, documents.id),
    )
    .where(
      and(
        inArray(documentChunks.documentId, documentIds),
        eq(documents.status, "READY"),
      ),
    );

  const queryTokens = tokenize(normalizedQuery);
  const scored = rows
    .map(({ chunk }) => ({
      ...chunk,
      score: scoreChunk(normalizedQuery, queryTokens, chunk.text),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.documentId.localeCompare(right.documentId) ||
        left.chunkIndex - right.chunkIndex,
    );

  return {
    query,
    chunks: scored.slice(0, limit),
    scannedChunkCount: rows.length,
    matchedChunkCount: scored.length,
  };
}
