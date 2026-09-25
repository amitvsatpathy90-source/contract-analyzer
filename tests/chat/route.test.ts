import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/chat/service", () => ({
  answerQuestion: vi.fn(),
}));

import { answerQuestion } from "@/server/chat/service";
import { POST } from "@/app/api/chat/route";

describe("POST /api/chat", () => {
  it("rejects invalid request bodies", async () => {
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

  it("returns the structured chat result", async () => {
    const documentId = "9b3e1e74-06b1-4d95-9fe0-b7c5a8fc8a90";

    vi.mocked(answerQuestion).mockResolvedValueOnce({
      answer: "The liability cap is AED 100,000.",
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
    expect(await response.json()).toEqual({
      answer: "The liability cap is AED 100,000.",
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
    });

    expect(answerQuestion).toHaveBeenCalledWith(
      documentId,
      "What is the liability cap?",
    );
  });
});

