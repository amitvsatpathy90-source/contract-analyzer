import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/chat/service", () => ({
  streamAnswerQuestion: vi.fn(),
}));

vi.mock("@/server/chat/history", () => ({
  getChatHistory: vi.fn(),
}));

import { getChatHistory } from "@/server/chat/history";
import { streamAnswerQuestion } from "@/server/chat/service";
import { GET, POST } from "@/app/api/chat/route";

describe("/api/chat", () => {
  it("rejects invalid POST request bodies", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What is the cap?" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A valid documentId and question are required.",
    });
  });

  it("streams chat events", async () => {
    const documentId = "9b3e1e74-06b1-4d95-9fe0-b7c5a8fc8a90";

    vi.mocked(streamAnswerQuestion).mockImplementation(async function* () {
      yield { type: "status", status: "Generating answer..." };
      yield { type: "answer_delta", delta: "The liability cap is " };
      yield { type: "answer_delta", delta: "AED 100,000." };
      yield {
        type: "citations",
        citations: [
          {
            documentId,
            quote: "The liability cap is AED 100,000.",
            verified: true,
            matches: [
              {
                startOffset: 0,
                endOffset: 33,
                text: "The liability cap is AED 100,000.",
              },
            ],
          },
        ],
      };
      yield { type: "done" };
    });

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId,
          question: "What is the liability cap?",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();

    expect(body).toContain('event: status\ndata: {"type":"status","status":"Generating answer..."}');
    expect(body).toContain('event: answer_delta\ndata: {"type":"answer_delta","delta":"The liability cap is "}');
    expect(body).toContain('event: done\ndata: {"type":"done"}');
    expect(streamAnswerQuestion).toHaveBeenCalledWith(
      documentId,
      "What is the liability cap?",
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("returns persisted chat history for a document", async () => {
    const documentId = "9b3e1e74-06b1-4d95-9fe0-b7c5a8fc8a90";

    vi.mocked(getChatHistory).mockResolvedValueOnce([
      {
        id: "message-1",
        role: "USER",
        content: "What is the liability cap?",
        citations: [],
        createdAt: new Date("2026-09-25T12:00:00.000Z"),
      },
    ]);

    const response = await GET(
      new Request(`http://localhost/api/chat?documentId=${documentId}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      messages: [
        {
          id: "message-1",
          role: "USER",
          content: "What is the liability cap?",
          citations: [],
          createdAt: "2026-09-25T12:00:00.000Z",
        },
      ],
    });
    expect(getChatHistory).toHaveBeenCalledWith(documentId);
  });

  it("rejects an invalid document id when loading history", async () => {
    const response = await GET(
      new Request("http://localhost/api/chat?documentId=not-a-uuid"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A valid documentId is required.",
    });
  });
});

