import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, postgresClient } from "@/server/db/client";
import { documentChunks, documents } from "@/server/db/schema";
import {
  answerQuestion,
  streamAnswerQuestion,
} from "@/server/chat/service";
import { getChatHistory } from "@/server/chat/history";

describe("chat service", () => {
  const createDocument = async (text: string) => {
    const documentId = randomUUID();

    await db.insert(documents).values({
      id: documentId,
      filename: "contract.pdf",
      mimeType: "application/pdf",
      status: "READY",
      storageKey: `documents/${documentId}/original.pdf`,
      extractedText: text,
    });

    await db.insert(documentChunks).values({
      id: randomUUID(),
      documentId,
      chunkIndex: 0,
      text,
      startOffset: 0,
      endOffset: text.length,
      tokenEstimate: Math.ceil(text.length / 4),
    });

    return documentId;
  };

  it("returns only server-verified citations", async () => {
    const text =
      "The liability cap is AED 100,000. Payment is due within thirty days.";
    const documentId = await createDocument(text);

    try {
      const result = await answerQuestion(
        documentId,
        "What is the liability cap?",
        async () => ({
          answer: "The liability cap is AED 100,000.",
          quotes: [
            "The liability cap is AED 100,000.",
            "The liability cap is AED 1,000,000.",
          ],
        }),
      );

      expect(result.answer).toBe("The liability cap is AED 100,000.");
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]).toMatchObject({
        documentId,
        quote: "The liability cap is AED 100,000.",
        verified: true,
      });
      expect(result.citations[0].matches[0]).toEqual({
        startOffset: 0,
        endOffset: "The liability cap is AED 100,000.".length,
        text: "The liability cap is AED 100,000.",
      });
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  it("abstains when the model provides no verifiable quote", async () => {
    const documentId = await createDocument(
      "The liability cap is AED 100,000.",
    );

    try {
      const result = await answerQuestion(
        documentId,
        "What is the liability cap?",
        async () => ({
          answer: "The cap is AED 1,000,000.",
          quotes: ["The cap is AED 1,000,000."],
        }),
      );

      expect(result).toEqual({
        answer:
          "I couldn't find support for an answer in the relevant document passages.",
        citations: [],
      });
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  it("does not call the model when retrieval finds no matching passage", async () => {
    const documentId = await createDocument(
      "The liability cap is AED 100,000.",
    );
    let called = false;

    try {
      const result = await answerQuestion(
        documentId,
        "Which jurisdiction governs this agreement?",
        async () => {
          called = true;
          return {
            answer: "Unknown",
            quotes: [],
          };
        },
      );

      expect(called).toBe(false);
      expect(result.citations).toEqual([]);
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  it("streams complete verified claims as model deltas", async () => {
    const text =
      "The liability cap is AED 100,000. Payment is due within thirty days.";
    const documentId = await createDocument(text);

    try {
      const events = [];

      for await (const event of streamAnswerQuestion(
        documentId,
        "What are the liability and payment terms?",
        async function* () {
          yield JSON.stringify({
            answer: "The liability cap is AED 100,000.",
            quote: "The liability cap is AED 100,000.",
          }) + "\n";
          yield JSON.stringify({
            answer: "Payment is due within thirty days.",
            quote: "Payment is due within thirty days.",
          }) + "\n";
        },
      )) {
        events.push(event);
      }

      expect(
        events
          .filter((event) => event.type === "answer_delta")
          .map((event) =>
            event.type === "answer_delta" ? event.delta : "",
          ),
      ).toEqual([
        "The liability cap is AED 100,000.",
        "\nPayment is due within thirty days.",
      ]);

      const history = await getChatHistory(documentId);
      expect(history[1]).toMatchObject({
        role: "ASSISTANT",
        content:
          "The liability cap is AED 100,000.\nPayment is due within thirty days.",
      });
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  it("ignores malformed or unverified streamed claims", async () => {
    const documentId = await createDocument(
      "The liability cap is AED 100,000.",
    );

    try {
      const events = [];

      for await (const event of streamAnswerQuestion(
        documentId,
        "What is the liability cap?",
        async function* () {
          yield "not-json\n";
          yield JSON.stringify({
            answer: "The cap is AED 1,000,000.",
            quote: "The cap is AED 1,000,000.",
          }) + "\n";
        },
      )) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: "answer_delta",
        delta:
          "I couldn't find support for an answer in the relevant document passages.",
      });
      expect(events).toContainEqual({ type: "citations", citations: [] });
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  it("persists the verified partial answer when the stream is stopped", async () => {
    const text =
      "The liability cap is AED 100,000. Payment is due within thirty days.";
    const documentId = await createDocument(text);

    try {
      const stream = streamAnswerQuestion(
        documentId,
        "What is the liability cap?",
        async function* () {
          yield JSON.stringify({
            answer: "The liability cap is AED 100,000.",
            quote: "The liability cap is AED 100,000.",
          }) + "\n";
          await new Promise(() => {});
        },
      );

      await stream.next();
      const firstDelta = await stream.next();

      expect(firstDelta.value).toEqual({
        type: "answer_delta",
        delta: "The liability cap is AED 100,000.",
      });

      await stream.return(undefined);

      const history = await getChatHistory(documentId);
      expect(history[1]).toMatchObject({
        role: "ASSISTANT",
        content: "The liability cap is AED 100,000.",
      });
    } finally {
      await db.delete(documents).where(eq(documents.id, documentId));
    }
  });

  afterAll(async () => {
    await postgresClient.end();
  });
});

