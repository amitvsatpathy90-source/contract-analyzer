import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, postgresClient } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import {
  verifyEvidence,
  verifyEvidenceInText,
} from "@/server/documents/evidence";

describe("evidence verification", () => {
  const documentId = "document-1";

  it("verifies an exact quote and returns its source offsets", () => {
    const text =
      "The payment terms are due within thirty days. The liability cap is AED 100,000.";

    const result = verifyEvidenceInText(
      documentId,
      text,
      "The liability cap is AED 100,000.",
    );

    expect(result.verified).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toEqual({
      startOffset: text.indexOf("The liability cap"),
      endOffset: text.length,
      text: "The liability cap is AED 100,000.",
    });
  });

  it("tolerates whitespace differences without changing source offsets", () => {
    const text = "The payment terms\r\nare due within   thirty days.";

    const result = verifyEvidenceInText(
      documentId,
      text,
      "The payment terms are due within thirty days.",
    );

    expect(result.verified).toBe(true);
    expect(result.matches[0]).toEqual({
      startOffset: 0,
      endOffset: text.length,
      text,
    });
  });

  it("rejects a paraphrase that is not present in the document", () => {
    const result = verifyEvidenceInText(
      documentId,
      "The payment terms are due within thirty days.",
      "Payment is due in one month.",
    );

    expect(result).toEqual({
      documentId,
      verified: false,
      matches: [],
    });
  });

  it("returns every duplicate occurrence", () => {
    const text =
      "Confidential information must be protected.\n\nConfidential information must be protected.";

    const result = verifyEvidenceInText(
      documentId,
      text,
      "Confidential information must be protected.",
    );

    expect(result.verified).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].startOffset).toBe(0);
    expect(result.matches[1].startOffset).toBe(
      text.indexOf("Confidential", 1),
    );
  });

  it("does not verify blank quotes", () => {
    const result = verifyEvidenceInText(
      documentId,
      "Contract text.",
      "   \n\t",
    );

    expect(result.verified).toBe(false);
    expect(result.matches).toEqual([]);
  });

  it("verifies evidence against the specified READY document", async () => {
    const readyId = randomUUID();
    const otherId = randomUUID();

    await db.insert(documents).values([
      {
        id: readyId,
        filename: "ready.pdf",
        mimeType: "application/pdf",
        status: "READY",
        storageKey: `documents/${readyId}/original.pdf`,
        extractedText: "The liability cap is AED 100,000.",
      },
      {
        id: otherId,
        filename: "other.pdf",
        mimeType: "application/pdf",
        status: "READY",
        storageKey: `documents/${otherId}/original.pdf`,
        extractedText: "The liability cap is AED 1,000,000.",
      },
    ]);

    const verified = await verifyEvidence(
      readyId,
      "The liability cap is AED 100,000.",
    );
    const wrongDocument = await verifyEvidence(
      readyId,
      "The liability cap is AED 1,000,000.",
    );

    expect(verified.verified).toBe(true);
    expect(verified.documentId).toBe(readyId);
    expect(wrongDocument.verified).toBe(false);
    expect(wrongDocument.matches).toEqual([]);

    await db.delete(documents).where(eq(documents.id, readyId));
    await db.delete(documents).where(eq(documents.id, otherId));
  });

  it("does not verify evidence for a non-ready document", async () => {
    const failedId = randomUUID();

    await db.insert(documents).values({
      id: failedId,
      filename: "failed.pdf",
      mimeType: "application/pdf",
      status: "FAILED",
      storageKey: `documents/${failedId}/original.pdf`,
      extractedText: "The liability cap is AED 100,000.",
    });

    const result = await verifyEvidence(
      failedId,
      "The liability cap is AED 100,000.",
    );

    expect(result).toEqual({
      documentId: failedId,
      verified: false,
      matches: [],
    });

    await db.delete(documents).where(eq(documents.id, failedId));
  });

  afterAll(async () => {
    await postgresClient.end();
  });
});
