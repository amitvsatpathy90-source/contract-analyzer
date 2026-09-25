import { describe, expect, it } from "vitest";

import { chunkDocument } from "@/server/documents/chunking";

describe("document chunking", () => {
  it("creates deterministic chunks with source offsets into canonical text", () => {
    const text = Array.from(
      { length: 40 },
      (_, index) =>
        `Clause ${index + 1}: The payment terms are due within thirty days.`,
    ).join("\n\n");

    const chunks = chunkDocument(text, {
      targetTokens: 40,
      overlapTokens: 5,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks).toEqual(
      chunkDocument(text, {
        targetTokens: 40,
        overlapTokens: 5,
      }),
    );

    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.startOffset, chunk.endOffset));
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
      expect(chunk.tokenEstimate).toBeGreaterThan(0);
    }

    expect(chunks[0].startOffset).toBe(0);
    expect(chunks.at(-1)?.endOffset).toBe(text.length);
  });

  it("returns no chunks for empty text", () => {
    expect(chunkDocument("   \n\n")).toEqual([]);
  });

  it("rejects invalid overlap configuration", () => {
    expect(() =>
      chunkDocument("contract text", {
        targetTokens: 10,
        overlapTokens: 10,
      }),
    ).toThrow("overlapTokens");
  });
});
