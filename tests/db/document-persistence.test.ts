import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, postgresClient } from "@/server/db/client";
import { documents } from "@/server/db/schema";

describe("document persistence", () => {
  it("creates, updates, reads and deletes a document", async () => {
    const documentId = randomUUID();

    await db.insert(documents).values({
      id: documentId,
      filename: "sample-contract.pdf",
      mimeType: "application/pdf",
      status: "PROCESSING",
      storageKey: `documents/${documentId}/sample-contract.pdf`,
    });

    const processingDocument = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));

    expect(processingDocument).toHaveLength(1);
    expect(processingDocument[0].status).toBe("PROCESSING");

    await db
      .update(documents)
      .set({
        status: "READY",
        extractedText: "This contract contains readable text.",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    const readyDocument = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));

    expect(readyDocument[0].status).toBe("READY");
    expect(readyDocument[0].extractedText).toContain(
      "readable text",
    );

    await db
      .delete(documents)
      .where(eq(documents.id, documentId));

    const deletedDocument = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));

    expect(deletedDocument).toHaveLength(0);
  });

  afterAll(async () => {
    await postgresClient.end();
  });
});
