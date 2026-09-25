import { randomUUID } from "node:crypto";

import { arrayContains, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, postgresClient } from "@/server/db/client";
import { documentChunks, documents, messages } from "@/server/db/schema";
import {
  deleteDocument,
  getDocument,
  listDocuments,
} from "@/server/documents/library";
import type { ObjectStorage } from "@/server/documents/storage";

class TestObjectStorage implements ObjectStorage {
  readonly keys = new Set<string>();
  shouldFailDelete = false;

  async put(key: string): Promise<void> {
    this.keys.add(key);
  }

  async get(): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async delete(key: string): Promise<void> {
    if (this.shouldFailDelete) {
      throw new Error("storage delete failed");
    }

    this.keys.delete(key);
  }
}

describe("document library", () => {
  it("lists documents newest first without returning extracted text", async () => {
    const olderId = randomUUID();
    const newerId = randomUUID();
    const now = new Date();

    await db.insert(documents).values([
      {
        id: olderId,
        filename: "older.pdf",
        mimeType: "application/pdf",
        status: "READY",
        storageKey: `documents/${olderId}/original.pdf`,
        extractedText: "Older contract text.",
        createdAt: new Date(now.getTime() - 1_000),
      },
      {
        id: newerId,
        filename: "newer.pdf",
        mimeType: "application/pdf",
        status: "PROCESSING",
        storageKey: `documents/${newerId}/original.pdf`,
        extractedText: "Newer contract text.",
        createdAt: now,
      },
    ]);

    try {
      const result = await listDocuments();

      const ownDocuments = result.filter(
        ({ id }) => id === newerId || id === olderId,
      );

      expect(ownDocuments).toEqual([
        expect.objectContaining({
          id: newerId,
          filename: "newer.pdf",
          status: "PROCESSING",
        }),
        expect.objectContaining({
          id: olderId,
          filename: "older.pdf",
          status: "READY",
        }),
      ]);
      expect(result[0]).not.toHaveProperty("extractedText");
    } finally {
      await db.delete(documents).where(eq(documents.id, newerId));
      await db.delete(documents).where(eq(documents.id, olderId));
    }
  });

  it("loads a document detail by id", async () => {
    const documentId = randomUUID();

    await db.insert(documents).values({
      id: documentId,
      filename: "contract.pdf",
      mimeType: "application/pdf",
      status: "READY",
      storageKey: `documents/${documentId}/original.pdf`,
      extractedText: "Contract text.",
      sourceMap: {
        kind: "pdf",
        pages: [{ pageNumber: 1, startOffset: 0, endOffset: 13 }],
      },
    });

    try {
      await expect(getDocument(documentId)).resolves.toMatchObject({
        id: documentId,
        filename: "contract.pdf",
        status: "READY",
        sourceMap: { kind: "pdf" },
      });
      await expect(getDocument(randomUUID())).resolves.toBeNull();
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  it("deletes the document, its chunks and its chat history", async () => {
    const documentId = randomUUID();
    const storageKey = `documents/${documentId}/original.pdf`;
    const storage = new TestObjectStorage();
    await storage.put(storageKey);

    await db.insert(documents).values({
      id: documentId,
      filename: "contract.pdf",
      mimeType: "application/pdf",
      status: "READY",
      storageKey,
      extractedText: "Contract text.",
    });
    await db.insert(documentChunks).values({
      id: randomUUID(),
      documentId,
      chunkIndex: 0,
      text: "Contract text.",
      startOffset: 0,
      endOffset: 13,
      tokenEstimate: 4,
    });
    await db.insert(messages).values({
      id: randomUUID(),
      documentIds: [documentId],
      role: "USER",
      content: "What is this?",
    });

    try {
      await expect(deleteDocument(documentId, storage)).resolves.toBe(true);
      await expect(getDocument(documentId)).resolves.toBeNull();
      await expect(
        db
          .select()
          .from(documentChunks)
          .where(eq(documentChunks.documentId, documentId)),
      ).resolves.toEqual([]);
      await expect(
        db
          .select()
          .from(messages)
          .where(arrayContains(messages.documentIds, [documentId])),
      ).resolves.toEqual([]);
      expect(storage.keys.has(storageKey)).toBe(false);
    } finally {
      await db.delete(messages).where(arrayContains(messages.documentIds, [documentId]));
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  it("keeps the document when object storage deletion fails", async () => {
    const documentId = randomUUID();
    const storage = new TestObjectStorage();
    storage.shouldFailDelete = true;

    await db.insert(documents).values({
      id: documentId,
      filename: "contract.pdf",
      mimeType: "application/pdf",
      status: "READY",
      storageKey: `documents/${documentId}/original.pdf`,
      extractedText: "Contract text.",
    });

    try {
      await expect(deleteDocument(documentId, storage)).rejects.toThrow(
        "storage delete failed",
      );
      await expect(getDocument(documentId)).resolves.toMatchObject({
        id: documentId,
      });
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  afterAll(async () => {
    await postgresClient.end();
  });
});
