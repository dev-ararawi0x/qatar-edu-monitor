# v0.3 textbook context pipeline — design boundary

This is a forward design note only; no v0.3 pipeline is implemented in v0.1.

## Fixed boundary

- Use only student-uploaded or explicitly provided textbook/material files that have been processed into a pre-indexed corpus.
- Do not scrape LMS lesson pages, files, or private course content as a substitute for uploaded materials.
- Do not give retrieval output tool use, network access, or instruction authority. Retrieved text is untrusted context passed to the existing draft-generation port.
- Retain source references (document, page/section, chunk identifier) with each generated draft so students can inspect provenance.

## Proposed pipeline

1. Upload and ownership: store object metadata scoped to the owning user; file bytes belong in object storage or another approved store, not in relational rows.
2. Extraction: parse supported document types into bounded text chunks; reject unsupported/corrupt files safely.
3. Indexing: create a user-scoped vector/keyword index. Never share embeddings or chunks across users without explicit tenant design.
4. Retrieval: for each normalized question, retrieve a small number of relevant chunks using subject/language metadata and citations.
5. Generation: pass question plus cited chunks to the existing `DraftGenerationPort`; validate answers exactly as v0.1 does.
6. Review: keep AI output local as drafts until a separately authorized human action exists; this design does not weaken the final-action gate.

## Deferred decisions

- Approved object store, file-size/count quota, extraction formats, embedding provider/data-processing terms, retention schedule, deletion propagation, and index consistency model.
- These decisions require the same data-map, provider-policy, security-review, and owner-scoping evidence as the rest of the system.
