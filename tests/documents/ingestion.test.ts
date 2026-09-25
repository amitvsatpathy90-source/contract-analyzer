import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, postgresClient } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import {
  DocumentIngestionError,
  ingestDocument,
} from "@/server/documents/ingestion";
import {
  PDF_MIME_TYPE,
} from "@/server/documents/validation";
import { InMemoryObjectStorage } from "./support/in-memory-object-storage";

function createPdf(text: string | null): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
  ];
  const stream = text
    ? `BT /F1 12 Tf 72 700 Td (${text.replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj ET`
    : "";
  objects.push(
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  );
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`);
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((value) => `${value.toString().padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    `${offset}`,
    "%%EOF",
    "",
  ].join("\n");
  chunks.push(Buffer.from(xref));
  return new Uint8Array(Buffer.concat(chunks));
}

describe("document ingestion", () => {
  it("stores a readable document and marks it READY", async () => {
    const storage = new InMemoryObjectStorage();
    const result = await ingestDocument(
      {
        name: "sample-contract.pdf",
        type: PDF_MIME_TYPE,
        arrayBuffer: async () => createPdf("Payment terms are due within thirty days.").buffer as ArrayBuffer,
      },
      storage,
    );

    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, result.id));

    expect(document.status).toBe("READY");
    expect(document.extractedText).toContain("Payment terms are due within thirty days.");
    expect(storage.has(result.storageKey)).toBe(true);

    await db.delete(documents).where(eq(documents.id, result.id));
  });

  it("stores a failed document when a PDF has no readable text", async () => {
    const storage = new InMemoryObjectStorage();
    const upload = {
      name: `scanned-${randomUUID()}.pdf`,
      type: PDF_MIME_TYPE,
      arrayBuffer: async () => createPdf(null).buffer as ArrayBuffer,
    };

    await expect(ingestDocument(upload, storage)).rejects.toMatchObject({
      statusCode: 422,
    } satisfies Partial<DocumentIngestionError>);

    const failed = await db
      .select()
      .from(documents)
      .where(eq(documents.filename, upload.name));

    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe("FAILED");
    expect(failed[0].extractedText).toBeNull();

    await db.delete(documents).where(eq(documents.id, failed[0].id));
  });

  afterAll(async () => {
    await postgresClient.end();
  });
});
