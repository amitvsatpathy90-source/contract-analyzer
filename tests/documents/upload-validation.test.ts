import { describe, expect, it } from "vitest";

import {
  DOCX_MIME_TYPE,
  PDF_MIME_TYPE,
  DocumentValidationError,
  validateUpload,
} from "@/server/documents/validation";

function file(name: string, type: string, bytes: number[]): { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  return {
    name,
    type,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}

describe("document upload validation", () => {
  it("accepts PDF uploads", async () => {
    const result = await validateUpload(
      file("contract.pdf", PDF_MIME_TYPE, [0x25, 0x50, 0x44, 0x46, 0x2d]),
    );

    expect(result.mimeType).toBe(PDF_MIME_TYPE);
  });

  it("accepts DOCX uploads", async () => {
    const result = await validateUpload(
      file("contract.docx", DOCX_MIME_TYPE, [0x50, 0x4b, 0x03, 0x04]),
    );

    expect(result.mimeType).toBe(DOCX_MIME_TYPE);
  });

  it("rejects unsupported file extensions", async () => {
    await expect(
      validateUpload(file("contract.txt", "text/plain", [0x74])),
    ).rejects.toThrowError(
      new DocumentValidationError(
        "Unsupported file type. Upload a PDF or DOCX file.",
      ),
    );
  });

  it("rejects a file whose content does not match its extension", async () => {
    await expect(
      validateUpload(file("contract.pdf", PDF_MIME_TYPE, [0x50, 0x4b, 0x03, 0x04])),
    ).rejects.toThrow("valid PDF file");
  });
});
