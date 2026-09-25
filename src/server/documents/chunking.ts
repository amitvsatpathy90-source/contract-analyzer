const DEFAULT_TARGET_TOKENS = 800;
const DEFAULT_OVERLAP_TOKENS = 120;
const CHARS_PER_TOKEN = 4;

export interface DocumentChunkDraft {
  chunkIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  tokenEstimate: number;
}

export interface ChunkingOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

function findEndBoundary(
  text: string,
  startOffset: number,
  targetEnd: number,
): number {
  if (targetEnd >= text.length) {
    return text.length;
  }

  const preferredStart =
    startOffset + Math.floor((targetEnd - startOffset) * 0.75);

  const candidates = [
    text.lastIndexOf("\n", targetEnd - 1),
    text.lastIndexOf(" ", targetEnd - 1),
    text.lastIndexOf("\t", targetEnd - 1),
  ];

  const boundary = Math.max(...candidates);

  return boundary >= preferredStart ? boundary + 1 : targetEnd;
}

function findStartBoundary(
  text: string,
  candidate: number,
  lowerBound: number,
): number {
  if (candidate <= lowerBound) {
    return candidate;
  }

  const candidates = [
    text.lastIndexOf("\n", candidate - 1),
    text.lastIndexOf(" ", candidate - 1),
    text.lastIndexOf("\t", candidate - 1),
  ];

  const boundary = Math.max(...candidates);

  return boundary >= lowerBound ? boundary + 1 : candidate;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function chunkDocument(
  text: string,
  options: ChunkingOptions = {},
): DocumentChunkDraft[] {
  if (!text.trim()) {
    return [];
  }

  const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;

  if (targetTokens <= 0) {
    throw new Error("targetTokens must be greater than zero.");
  }

  if (overlapTokens < 0 || overlapTokens >= targetTokens) {
    throw new Error(
      "overlapTokens must be greater than or equal to zero and smaller than targetTokens.",
    );
  }

  const targetChars = targetTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;
  const chunks: DocumentChunkDraft[] = [];

  let startOffset = 0;

  while (startOffset < text.length) {
    const targetEnd = Math.min(text.length, startOffset + targetChars);
    const endOffset = findEndBoundary(text, startOffset, targetEnd);
    const chunkText = text.slice(startOffset, endOffset);

    if (chunkText.length === 0) {
      throw new Error("Chunking produced an empty chunk.");
    }

    chunks.push({
      chunkIndex: chunks.length,
      text: chunkText,
      startOffset,
      endOffset,
      tokenEstimate: estimateTokens(chunkText),
    });

    if (endOffset >= text.length) {
      break;
    }

    const candidateStart = Math.max(startOffset + 1, endOffset - overlapChars);
    startOffset = findStartBoundary(text, candidateStart, startOffset + 1);
  }

  return chunks;
}
