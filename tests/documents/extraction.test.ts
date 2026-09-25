import { describe, expect, it } from "vitest";

import {
  extractDocument,
  UnreadableDocumentError,
} from "@/server/documents/extraction";
import {
  DOCX_MIME_TYPE,
  PDF_MIME_TYPE,
} from "@/server/documents/validation";

function createPdf(text: string | null): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
  ];

  const escaped = (text ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
  const stream = text
    ? `BT /F1 12 Tf 72 700 Td (${escaped}) Tj ET`
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

  const xrefOffset = offset;
  const xref = [
    `xref`,
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((value) => `${value.toString().padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    `${xrefOffset}`,
    "%%EOF",
    "",
  ].join("\n");

  chunks.push(Buffer.from(xref));
  return new Uint8Array(Buffer.concat(chunks));
}

function createDocx(): Uint8Array {
  const encoded =
    "UEsDBBQAAAAIAEpGOV3XeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMEFAAAAAgASkY5XSAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMEFAAAAAgASkY5XezrV8veAAAAVgEAABEAAAB3b3JkL2RvY3VtZW50LnhtbH2Qz2rDMAzG730K4fMWuzuMEZKUwdZzD90DuLbWGOI/SG4zv/3sQG9jlx/6kPR9QsPhxy9wR2IXwyj2nRKAwUTrwnUUX+fj85sAzjpYvcSAoyjI4jDthrW30dw8hgzVIXC/jmLOOfVSspnRa+5iwlB735G8zlXSVa6RbKJokLkG+EW+KPUqvXZBTDuA6nqJtrRyE2mqoIY8nXTZ0jKSZ9CEYG8Iq8uzC1BBuYDVhbtBtvFG2pj+tDvPCIvTF7e4umh0Asfw/vkBe6WelFL/2DCafCK5HSwfF7fq8ZHpF1BLAQIUAxQAAAAIAEpGOV3XeYTq8QAAALgBAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgASkY5XSAbhuqyAAAALgEAAAsAAAAAAAAAAAAAAIABIgEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgASkY5XezrV8veAAAAVgEAABEAAAAAAAAAAAAAAIAB/QEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAAoDAAAAAA==";
  return Uint8Array.from(Buffer.from(encoded, "base64"));
}

describe("document extraction", () => {
  it("extracts readable PDF text and records page offsets", async () => {
    const result = await extractDocument(
      createPdf("Payment terms are due within thirty days."),
      PDF_MIME_TYPE,
    );

    expect(result.text).toContain("Payment terms are due within thirty days.");
    expect(result.sourceMap).toEqual({
      kind: "pdf",
      pages: [
        {
          pageNumber: 1,
          startOffset: 0,
          endOffset: result.text.length,
        },
      ],
    });
  });

  it("rejects a PDF with no readable text", async () => {
    await expect(
      extractDocument(createPdf(null), PDF_MIME_TYPE),
    ).rejects.toBeInstanceOf(UnreadableDocumentError);
  });

  it("extracts raw DOCX text", async () => {
    const result = await extractDocument(createDocx(), DOCX_MIME_TYPE);

    expect(result.text).toContain("Payment terms are due within thirty days.");
    expect(result.text).toContain("The liability cap is AED 100,000.");
    expect(result.sourceMap).toBeNull();
  });
});
