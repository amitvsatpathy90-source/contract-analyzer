import { NextResponse } from "next/server";
import { z } from "zod";

import { answerQuestion } from "@/server/chat/service";

export const runtime = "nodejs";

const requestSchema = z.object({
  documentId: z.uuid(),
  question: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The chat request must contain valid JSON." },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid documentId and question are required." },
      { status: 400 },
    );
  }

  try {
    const result = await answerQuestion(
      parsed.data.documentId,
      parsed.data.question,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat request failed", { error });

    return NextResponse.json(
      { error: "The question could not be answered." },
      { status: 500 },
    );
  }
}

