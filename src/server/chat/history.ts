import { randomUUID } from "node:crypto";
import { arrayContains, asc } from "drizzle-orm";

import { db } from "@/server/db/client";
import { messages } from "@/server/db/schema";
import type { ChatCitation } from "./service";

export interface ChatHistoryMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations: ChatCitation[];
  createdAt: Date;
}

export async function saveUserMessage(
  documentId: string,
  content: string,
): Promise<void> {
  await db.insert(messages).values({
    id: randomUUID(),
    documentIds: [documentId],
    role: "USER",
    content,
  });
}

export async function saveAssistantMessage(
  documentId: string,
  content: string,
  citations: ChatCitation[],
): Promise<void> {
  await db.insert(messages).values({
    id: randomUUID(),
    documentIds: [documentId],
    role: "ASSISTANT",
    content,
    citations,
  });
}

export async function getChatHistory(
  documentId: string,
): Promise<ChatHistoryMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      citations: messages.citations,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(arrayContains(messages.documentIds, [documentId]))
    .orderBy(asc(messages.createdAt));

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    citations: Array.isArray(row.citations)
      ? (row.citations as ChatCitation[])
      : [],
    createdAt: row.createdAt,
  }));
}

