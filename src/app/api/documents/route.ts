import { NextResponse } from "next/server";

import {
  DocumentIngestionError,
  ingestDocument,
} from "@/server/documents/ingestion";
import { DocumentValidationError } from "@/server/documents/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "The upload request could not be read." },
      { status: 400 },
    );
  }

  const value = formData.get("file");

  if (!(value instanceof File)) {
    return NextResponse.json(
      { error: "A PDF or DOCX file is required." },
      { status: 400 },
    );
  }

  try {
    const document = await ingestDocument(value);

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    if (error instanceof DocumentIngestionError) {
      return NextResponse.json(
        {
          error: error.message,
          documentId: error.documentId,
        },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      { error: "The document could not be processed." },
      { status: 500 },
    );
  }
}
