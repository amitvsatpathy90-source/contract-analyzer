import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/documents/library", () => ({
  listDocuments: vi.fn(),
  deleteDocument: vi.fn(),
  getDocument: vi.fn(),
  getDocumentWithStorageKey: vi.fn(),
}));

import { deleteDocument, getDocument, listDocuments } from "@/server/documents/library";
import { GET as listGet } from "@/app/api/documents/route";
import { DELETE, GET as detailGet } from "@/app/api/documents/[id]/route";

describe("document library routes", () => {
  it("lists documents", async () => {
    vi.mocked(listDocuments).mockResolvedValueOnce([]);

    const response = await listGet();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ documents: [] });
  });

  it("loads a document by id", async () => {
    const documentId = "9b3e1e74-06b1-4d95-9fe0-b7c5a8fc8a90";
    vi.mocked(getDocument).mockResolvedValueOnce({
      id: documentId,
      filename: "contract.pdf",
      mimeType: "application/pdf",
      status: "READY",
      createdAt: new Date("2026-09-25T12:00:00.000Z"),
      updatedAt: new Date("2026-09-25T12:00:00.000Z"),
      sourceMap: { kind: "pdf" },
    });

    const response = await detailGet(
      new Request(`http://localhost/api/documents/${documentId}`),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).document.id).toBe(documentId);
  });

  it("deletes a document", async () => {
    const documentId = "9b3e1e74-06b1-4d95-9fe0-b7c5a8fc8a90";
    vi.mocked(deleteDocument).mockResolvedValueOnce(true);

    const response = await DELETE(
      new Request(`http://localhost/api/documents/${documentId}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(deleteDocument).toHaveBeenCalledWith(documentId);
  });

  it("returns 404 when deleting an unknown document", async () => {
    const documentId = "9b3e1e74-06b1-4d95-9fe0-b7c5a8fc8a90";
    vi.mocked(deleteDocument).mockResolvedValueOnce(false);

    const response = await DELETE(
      new Request(`http://localhost/api/documents/${documentId}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(404);
  });

  it("rejects an invalid document id", async () => {
    const response = await detailGet(
      new Request("http://localhost/api/documents/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
  });
});
