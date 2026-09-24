import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Explicit DB-level lifecycle states.
 *
 * Keeping these states in Postgres prevents arbitrary status strings
 * from leaking into persistence.
 */
export const documentStatusEnum = pgEnum("document_status", [
  "PROCESSING",
  "READY",
  "FAILED",
]);

/**
 * Chat roles that are persisted in history.
 *
 * Tool activity is deliberately not modeled here yet;
 * that belongs to the agent orchestration.
 */
export const messageRoleEnum = pgEnum("message_role", [
  "USER",
  "ASSISTANT",
]);

/**
 * Uploaded contracts.
 *
 * extractedText and sourceMap remain nullable because a document can
 * exist in PROCESSING or FAILED state before extraction completes.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),

    filename: text("filename").notNull(),

    mimeType: text("mime_type").notNull(),

    status: documentStatusEnum("status")
      .notNull()
      .default("PROCESSING"),

    /**
     * Object-storage key for the original PDF/DOCX.
     */
    storageKey: text("storage_key").notNull(),

    /**
     * Canonical extracted text used by retrieval and evidence verification.
     */
    extractedText: text("extracted_text"),

    /**
     * Renderer/source metadata used later to resolve verified text
     * back to PDF/DOCX locations for citation highlighting.
     */
    sourceMap: jsonb("source_map"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("documents_created_at_idx").on(table.createdAt),
    index("documents_status_idx").on(table.status),
  ],
);

/**
 * Deterministic chunks created from canonical extracted text.
 *
 * startOffset/endOffset let later retrieval return the exact source
 * range without trusting model-generated offsets.
 */
export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey(),

    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, {
        onDelete: "cascade",
      }),

    chunkIndex: integer("chunk_index").notNull(),

    text: text("text").notNull(),

    startOffset: integer("start_offset").notNull(),

    endOffset: integer("end_offset").notNull(),

    /**
     * Approximate token count used for retrieval/prompt budgeting.
     * It is intentionally not tied to a provider tokenizer.
     */
    tokenEstimate: integer("token_estimate").notNull(),
  },
  (table) => [
    // Prevent a file from accidentally generating duplicate sequence blocks.
    uniqueIndex("document_chunks_document_index_uq").on(
      table.documentId,
      table.chunkIndex,
    ),
    index("document_chunks_document_idx").on(table.documentId),
  ],
);

/**
 * Per-document conversation history.
 *
 * documentIds is an array because one message can belong to a
 * multi-document question.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),

    documentIds: uuid("document_ids").array().notNull(),

    role: messageRoleEnum("role").notNull(),

    content: text("content").notNull(),

    /**
     * Populated later with server-verified citation objects.
     * Nullable because user messages have no citations.
     */
    citations: jsonb("citations"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("messages_created_at_idx").on(table.createdAt),

    /**
     * GIN supports efficient membership/containment queries over
     * the document UUID array when multi-document history is queried.
     */
    index("messages_document_ids_gin_idx").using(
      "gin",
      table.documentIds,
    ),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
