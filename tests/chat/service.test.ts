import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, postgresClient } from "@/server/db/client";
import { documentChunks, documents } from "@/server/db/schema";
import { answerQuestion } from "@/server/chat/service";

describe("chat service", () => {
  const createDocument = async (text: string) => {
    const documentId = randomUUID();

    await db.insert(documents).values({
      id: documentId,
      filename: "contract.pdf",
      mimeType: "application/pdf",
      status: "READY",
      storageKey: `documents/${documentId}/original.pdf`,
      extractedText: text,
    });

    await db.insert(documentChunks).values({
      id: randomUUID(),
      documentId,
      chunkIndex: 0,
      text,
      startOffset: 0,
      endOffset: text.length,
      tokenEstimate: Math.ceil(text.length / 4),
    });

    return documentId;
  };

  it("returns only server-verified citations", async () => {
    const text =
      "The liability cap is AED 100,000. Payment is due within thirty days.";
    const documentId = await createDocument(text);

    try {
      const result = await answerQuestion(
        documentId,
        "What is the liability cap?",
        async () => ({
          answer: "The liability cap is AED 100,000.",
          quotes: [
            "The liability cap is AED 100,000.",
            "The liability cap is AED 1,000,000.",
          ],
        }),
      );

      expect(result.answer).toBe("The liability cap is AED 100,000.");
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]).toMatchObject({
        documentId,
        quote: "The liability cap is AED 100,000.",
        verified: true,
      });
      expect(result.citations[0].matches[0]).toEqual({
        startOffset: 0,
        endOffset: "The liability cap is AED 100,000.".length,
        text: "The liability cap is AED 100,000.",
      });
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  it("abstains when the model provides no verifiable quote", async () => {
    const documentId = await createDocument(
      "The liability cap is AED 100,000.",
    );

    try {
      const result = await answerQuestion(
        documentId,
        "What is the liability cap?",
        async () => ({
          answer: "The cap is AED 1,000,000.",
          quotes: ["The cap is AED 1,000,000."],
        }),
      );

      expect(result).toEqual({
        answer:
          "I couldn't find support for an answer in the relevant document passages.",
        citations: [],
      });
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  it("does not call the model when retrieval finds no matching passage", async () => {
    const documentId = await createDocument(
      "The liability cap is AED 100,000.",
    );
    let called = false;

    try {
      const result = await answerQuestion(
        documentId,
        "Which jurisdiction governs this agreement?",
        async () => {
          called = true;
          return {
            answer: "Unknown",
            quotes: [],
          };
        },
      );

      expect(called).toBe(false);
      expect(result.citations).toEqual([]);
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  afterAll(async () => {
    await postgresClient.end();
  });
});

