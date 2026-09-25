import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { documentChunks, documents } from "@/server/db/schema";

import { chunkDocument } from "./chunking";
import { extractDocument, UnreadableDocumentError } from "./extraction";
import { getObjectStorage, type ObjectStorage } from "./storage";
import { validateUpload, type UploadFile } from "./validation";

export class DocumentIngestionError extends Error {
  constructor(
    message: string,
    public readonly documentId: string,
    public readonly statusCode: 422 | 500,
  ) {
    super(message);
    this.name = "DocumentIngestionError";
  }
}

function createStorageKey(documentId: string, filename: string): string {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return `documents/${documentId}/original${extension}`;
}

export async function ingestDocument(
  file: UploadFile,
  storage: ObjectStorage = getObjectStorage(),
) {
  const upload = await validateUpload(file);
  const documentId = randomUUID();
  const storageKey = createStorageKey(documentId, upload.filename);

  await db.insert(documents).values({
    id: documentId,
    filename: upload.filename,
    mimeType: upload.mimeType,
    status: "PROCESSING",
    storageKey,
  });

  try {
    await storage.put(storageKey, upload.bytes, upload.mimeType);

    const extraction = await extractDocument(upload.bytes, upload.mimeType);
    const chunks = chunkDocument(extraction.text);

    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          extractedText: extraction.text,
          sourceMap: extraction.sourceMap,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      await tx.insert(documentChunks).values(
        chunks.map((chunk) => ({
          id: randomUUID(),
          documentId,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          tokenEstimate: chunk.tokenEstimate,
        })),
      );

      await tx
        .update(documents)
        .set({
          status: "READY",
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
    });

    return {
      id: documentId,
      filename: upload.filename,
      mimeType: upload.mimeType,
      status: "READY" as const,
      storageKey,
    };
  } catch (error) {
    try {
      await db
        .update(documents)
        .set({
          status: "FAILED",
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
    } catch (statusError) {
      console.error("Failed to mark document ingestion as FAILED", {
        documentId,
        statusError,
      });
    }

    if (error instanceof UnreadableDocumentError) {
      throw new DocumentIngestionError(error.message, documentId, 422);
    }

    console.error("Document ingestion failed", {
      documentId,
      error,
    });

    throw new DocumentIngestionError(
      "The document could not be processed.",
      documentId,
      500,
    );
  }
}
