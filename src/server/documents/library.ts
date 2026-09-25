import { arrayContains, desc, eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { documents, messages } from "@/server/db/schema";
import { getObjectStorage, type ObjectStorage } from "./storage";

export interface DocumentListItem {
  id: string;
  filename: string;
  mimeType: string;
  status: "PROCESSING" | "READY" | "FAILED";
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentDetail extends DocumentListItem {
  sourceMap: unknown;
}

export async function listDocuments(): Promise<DocumentListItem[]> {
  return db
    .select({
      id: documents.id,
      filename: documents.filename,
      mimeType: documents.mimeType,
      status: documents.status,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .orderBy(desc(documents.createdAt));
}

export async function getDocument(
  documentId: string,
): Promise<DocumentDetail | null> {
  const [document] = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      mimeType: documents.mimeType,
      status: documents.status,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      sourceMap: documents.sourceMap,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  return document ?? null;
}

export async function getDocumentWithStorageKey(documentId: string) {
  const [document] = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      mimeType: documents.mimeType,
      status: documents.status,
      storageKey: documents.storageKey,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  return document ?? null;
}

export async function deleteDocument(
  documentId: string,
  storage: ObjectStorage = getObjectStorage(),
): Promise<boolean> {
  const document = await getDocumentWithStorageKey(documentId);

  if (!document) {
    return false;
  }

  // Keep the database row when object deletion fails so the document remains retryable.
  await storage.delete(document.storageKey);

  await db.transaction(async (tx) => {
    await tx
      .delete(messages)
      .where(arrayContains(messages.documentIds, [documentId]));

    await tx.delete(documents).where(eq(documents.id, documentId));
  });

  return true;
}
