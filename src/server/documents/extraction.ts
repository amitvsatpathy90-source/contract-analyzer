import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as mammoth from "mammoth";
import path from "node:path";

import {
  DOCX_MIME_TYPE,
  PDF_MIME_TYPE,
  type SupportedMimeType,
} from "./validation";

export interface PdfPageSourceMapEntry {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
}

export interface PdfSourceMap {
  kind: "pdf";
  pages: PdfPageSourceMapEntry[];
}

export interface ExtractionResult {
  text: string;
  sourceMap: PdfSourceMap | null;
}

export class UnreadableDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableDocumentError";
  }
}

function textFromPdfItem(item: unknown): string {
  if (
    item &&
    typeof item === "object" &&
    "str" in item &&
    typeof item.str === "string"
  ) {
    return item.str;
  }

  return "";
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  const standardFontDataUrl =
  path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "standard_fonts",
  ) + path.sep;

const loadingTask = getDocument({
  data: bytes,
  standardFontDataUrl,
});
  const pageTexts: string[] = [];

  try {
    const pdf = await loadingTask.promise;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(textFromPdfItem).join(" ");

      pageTexts.push(pageText);
      page.cleanup();
    }

    const pages: PdfPageSourceMapEntry[] = [];
    let offset = 0;

    for (let index = 0; index < pageTexts.length; index += 1) {
      const pageText = pageTexts[index];
      const startOffset = offset;
      const endOffset = startOffset + pageText.length;

      pages.push({
        pageNumber: index + 1,
        startOffset,
        endOffset,
      });

      offset = endOffset + (index < pageTexts.length - 1 ? 2 : 0);
    }

    const text = pageTexts.join("\n\n");

    if (!text.trim()) {
      throw new UnreadableDocumentError(
        "The PDF contains no readable text. Scanned PDFs without a text layer are not supported.",
      );
    }

    return {
      text,
      sourceMap: {
        kind: "pdf",
        pages,
      },
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractionResult> {
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(bytes),
  });
  const text = result.value;

  if (!text.trim()) {
    throw new UnreadableDocumentError(
      "The DOCX contains no readable text.",
    );
  }

  return {
    text,
    sourceMap: null,
  };
}

export async function extractDocument(
  bytes: Uint8Array,
  mimeType: SupportedMimeType,
): Promise<ExtractionResult> {
  if (mimeType === PDF_MIME_TYPE) {
    return extractPdf(bytes);
  }

  if (mimeType === DOCX_MIME_TYPE) {
    return extractDocx(bytes);
  }

  throw new Error(`Unsupported document MIME type: ${mimeType}`);
}
