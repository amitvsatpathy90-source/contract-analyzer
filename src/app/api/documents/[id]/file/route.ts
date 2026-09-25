import { NextResponse } from "next/server";
import { z } from "zod";

import { getDocumentWithStorageKey } from "@/server/documents/library";
import { getObjectStorage } from "@/server/documents/storage";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.uuid() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid document id is required." },
      { status: 400 },
    );
  }

  try {
    const document = await getDocumentWithStorageKey(parsed.data.id);

    if (!document) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 },
      );
    }

    const bytes = await getObjectStorage().get(document.storageKey);

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": document.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Document file request failed", { documentId: parsed.data.id, error });

    return NextResponse.json(
      { error: "The document file could not be loaded." },
      { status: 500 },
    );
  }
}
