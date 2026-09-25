import { NextResponse } from "next/server";
import { z } from "zod";

import { getChatHistory } from "@/server/chat/history";
import {
  streamAnswerQuestion,
  type ChatStreamEvent,
} from "@/server/chat/service";

export const runtime = "nodejs";

const requestSchema = z.object({
  documentId: z.uuid(),
  question: z.string().trim().min(1).max(4000),
});

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

export async function GET(request: Request) {
  const documentId = new URL(request.url).searchParams.get("documentId");
  const parsed = z.uuid().safeParse(documentId);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid documentId is required." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      messages: await getChatHistory(parsed.data),
    });
  } catch (error) {
    console.error("Chat history request failed", { error });

    return NextResponse.json(
      { error: "The chat history could not be loaded." },
      { status: 500 },
    );
  }
}

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

  const streamController = new AbortController();
  const abortStream = () => streamController.abort();
  request.signal.addEventListener("abort", abortStream, { once: true });

  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamAnswerQuestion(
          parsed.data.documentId,
          parsed.data.question,
          undefined,
          streamController.signal,
        )) {
          if (streamController.signal.aborted) {
            break;
          }

          controller.enqueue(encodeEvent(event));
        }
      } finally {
        request.signal.removeEventListener("abort", abortStream);

        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      streamController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

