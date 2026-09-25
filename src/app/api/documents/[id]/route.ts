import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteDocument, getDocument } from "@/server/documents/library";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.uuid() });

function parseParams(params: { id: string }) {
  return paramsSchema.safeParse(params);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = parseParams(await context.params);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid document id is required." },
      { status: 400 },
    );
  }

  try {
    const document = await getDocument(parsed.data.id);

    if (!document) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ document });
  } catch (error) {
    console.error("Document request failed", { documentId: parsed.data.id, error });

    return NextResponse.json(
      { error: "The document could not be loaded." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = parseParams(await context.params);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid document id is required." },
      { status: 400 },
    );
  }

  try {
    const deleted = await deleteDocument(parsed.data.id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Document deletion failed", { documentId: parsed.data.id, error });

    return NextResponse.json(
      { error: "The document could not be deleted." },
      { status: 500 },
    );
  }
}
