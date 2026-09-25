Contract Analyzer

A backend for analysing legal contracts using PDF/DOCX documents.

Implemented:
- PDF/DOCX upload, validation, extraction and storage
- Deterministic chunking and lexical retrieval
- Server-side, whitespace-tolerant citation verification
- Streaming chat with persisted per-document history
- Document list, retrieval and deletion APIs
- Local and S3-compatible object storage

Citation verification:
The model returns an answer and source quotes.
The server checks each quote against the document's stored extracted text.
Whitespace differences are normalized.
Unverified quotes are discarded.
The server derives the actual source offsets; model-generated positions are not trusted.

Design:
The implementation uses deterministic retrieval and a small set of reusable backend components instead of introducing a vector database or embedding pipeline.

Status:
The core backend is implemented, but the assignment is only partially complete.
The application UI, citation highlighting, multi-document Q&A, contract comparison, and Part C agentic research are still pending.
