import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { documents } from "@/server/db/schema";

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

    await db
      .update(documents)
      .set({
        status: "READY",
        extractedText: extraction.text,
        sourceMap: extraction.sourceMap,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

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
