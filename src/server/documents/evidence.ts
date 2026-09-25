import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { documents } from "@/server/db/schema";

export interface EvidenceMatch {
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface EvidenceVerificationResult {
  documentId: string;
  verified: boolean;
  matches: EvidenceMatch[];
}

interface NormalizedText {
  text: string;
  sourceOffsets: number[];
}

function normalizeWithOffsets(text: string): NormalizedText {
  let normalized = "";
  const sourceOffsets: number[] = [];
  let pendingWhitespace = false;
  let pendingWhitespaceOffset = -1;

  for (let index = 0; index < text.length; index += 1) {
    if (/\s/u.test(text[index])) {
      if (!pendingWhitespace) {
        pendingWhitespace = true;
        pendingWhitespaceOffset = index;
      }
      continue;
    }

    if (pendingWhitespace && normalized.length > 0) {
      normalized += " ";
      sourceOffsets.push(pendingWhitespaceOffset);
    }

    pendingWhitespace = false;
    pendingWhitespaceOffset = -1;
    normalized += text[index];
    sourceOffsets.push(index);
  }

  return {
    text: normalized,
    sourceOffsets,
  };
}

function normalizeQuote(quote: string): string {
  return normalizeWithOffsets(quote).text.trim();
}

function findMatches(documentText: string, quote: string): EvidenceMatch[] {
  const normalizedDocument = normalizeWithOffsets(documentText);
  const normalizedQuote = normalizeQuote(quote);

  if (!normalizedQuote) {
    return [];
  }

  const matches: EvidenceMatch[] = [];
  let searchStart = 0;

  while (
    searchStart <=
    normalizedDocument.text.length - normalizedQuote.length
  ) {
    const matchStart = normalizedDocument.text.indexOf(
      normalizedQuote,
      searchStart,
    );

    if (matchStart === -1) {
      break;
    }

    const matchEnd = matchStart + normalizedQuote.length;
    const startOffset = normalizedDocument.sourceOffsets[matchStart];
    const lastCharacterOffset =
      normalizedDocument.sourceOffsets[matchEnd - 1];

    matches.push({
      startOffset,
      endOffset: lastCharacterOffset + 1,
      text: documentText.slice(startOffset, lastCharacterOffset + 1),
    });

    searchStart = matchStart + 1;
  }

  return matches;
}

export function verifyEvidenceInText(
  documentId: string,
  documentText: string,
  quote: string,
): EvidenceVerificationResult {
  const matches = findMatches(documentText, quote);

  return {
    documentId,
    verified: matches.length > 0,
    matches,
  };
}

export async function verifyEvidence(
  documentId: string,
  quote: string,
): Promise<EvidenceVerificationResult> {
  const [document] = await db
    .select({
      id: documents.id,
      status: documents.status,
      extractedText: documents.extractedText,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!document || document.status !== "READY" || !document.extractedText) {
    return {
      documentId,
      verified: false,
      matches: [],
    };
  }
  return verifyEvidenceInText(document.id, document.extractedText, quote);
}
