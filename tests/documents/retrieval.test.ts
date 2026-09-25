import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, postgresClient } from "@/server/db/client";
import { documentChunks, documents } from "@/server/db/schema";
import { retrieveChunks } from "@/server/documents/retrieval";

describe("document retrieval", () => {
  it("ranks matching chunks and scans only READY documents", async () => {
    const readyId = randomUUID();
    const failedId = randomUUID();

    await db.insert(documents).values([
      {
        id: readyId,
        filename: "ready.pdf",
        mimeType: "application/pdf",
        status: "READY",
        storageKey: `documents/${readyId}/original.pdf`,
        extractedText: "Payment terms. Liability cap.",
      },
      {
        id: failedId,
        filename: "failed.pdf",
        mimeType: "application/pdf",
        status: "FAILED",
        storageKey: `documents/${failedId}/original.pdf`,
        extractedText: "Payment terms. Liability cap.",
      },
    ]);

    const paymentText = "The payment terms are due within thirty days.";
    const liabilityText = "The liability cap is AED 100,000.";
    const provisionText = "The agreement contains a liability provision.";
    const failedText = "The liability cap is AED 1,000,000.";

    await db.insert(documentChunks).values([
      {
        id: randomUUID(),
        documentId: readyId,
        chunkIndex: 0,
        text: paymentText,
        startOffset: 0,
        endOffset: paymentText.length,
        tokenEstimate: 12,
      },
      {
        id: randomUUID(),
        documentId: readyId,
        chunkIndex: 1,
        text: liabilityText,
        startOffset: paymentText.length,
        endOffset: paymentText.length + liabilityText.length,
        tokenEstimate: 9,
      },
      {
        id: randomUUID(),
        documentId: readyId,
        chunkIndex: 2,
        text: provisionText,
        startOffset: paymentText.length + liabilityText.length,
        endOffset:
          paymentText.length + liabilityText.length + provisionText.length,
        tokenEstimate: 10,
      },
      {
        id: randomUUID(),
        documentId: failedId,
        chunkIndex: 0,
        text: failedText,
        startOffset: 0,
        endOffset: failedText.length,
        tokenEstimate: 9,
      },
    ]);

    const result = await retrieveChunks({
      documentIds: [readyId, failedId],
      query: "liability cap",
      limit: 1,
    });

    expect(result.scannedChunkCount).toBe(3);
    expect(result.matchedChunkCount).toBe(2);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].documentId).toBe(readyId);
    expect(result.chunks[0].chunkIndex).toBe(1);
    expect(result.chunks[0].text).toContain("AED 100,000");

    await db.delete(documents).where(eq(documents.id, readyId));
    await db.delete(documents).where(eq(documents.id, failedId));
  });

  it("returns an empty result for a blank query", async () => {
    const result = await retrieveChunks({
      documentIds: [randomUUID()],
      query: "   ",
    });

    expect(result).toEqual({
      query: "   ",
      chunks: [],
      scannedChunkCount: 0,
      matchedChunkCount: 0,
    });
  });

  afterAll(async () => {
    await postgresClient.end();
  });
});
