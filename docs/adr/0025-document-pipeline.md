# 0025. Document pipeline: ports, text layer first, OCR through the gateway

## Status

Proposed

## Date

2026-10-23

## Context

Issue #45 turns a stored capture into a `document` with per-page text, a language tag, a kind, page images and a search vector. [ADR 0021](0021-capture-inbox-and-upload-pipeline.md) leaves the raw file at L1 and enqueues `capture.process`; [ADR 0022](0022-ai-gateway-implementation.md) routes every model call through the gateway. This ADR records how the pipeline sits between them.

## Decision drivers

- Unreadable input is never guessed: it is kept raw and the capture goes to "Needs you".
- A sensitive matter or `ai_blocked` capture skips every AI step.
- `packages/intelligence` may not import `@causedeck/core`; only core depends on it.
- Re-running `capture.process` for the same `(sha256, pipelineVersion)` creates nothing new.

## Considered options

| Option                                                                    | Verdict  | Reason                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline in `packages/intelligence` behind injected ports                 | Chosen   | Follows the boundary rule; core wires the gateway, storage, database and events in the job body                                                                                                       |
| Pipeline inside `packages/core/src/capture`                               | Rejected | Pulls pdfjs, mupdf and sharp into core and mixes parsing with domain rules                                                                                                                            |
| OCR every page                                                            | Rejected | Cost and latency; a text layer is exact and free                                                                                                                                                      |
| Text layer first, OCR for pages under 40 normalised characters or garbled | Chosen   | Meets the 20-page budget and catches legacy-font (Nudi, Baraha) layers that look like text                                                                                                            |
| `pdfjs-dist` for text, `mupdf` (WASM) for rendering, `mammoth` for DOCX   | Chosen   | pdfjs runs no script; mupdf renders without a JavaScript engine; both are in-process, no external binary                                                                                              |
| `sharp` for WebP                                                          | Chosen   | 150 DPI thumbnail and 1024 px preview from the rendered PNG                                                                                                                                           |
| Literal `documents/{id}/pages/{n}.webp` keys                              | Rejected | Object keys are fixed to `ws/<workspace>/<kind>/<yyyy>/<uuid>`; `storeSystemBlob` (kind `image`) gives the workspace prefix and envelope encryption, and `document_page.image_key` holds the blob key |

## Decision

- **Steps**: sniff by magic bytes, read the text layer, select weak pages (coverage under `minPageChars`, default 40, or garbled), OCR those pages through the gateway `ocr` task with an `en`/`ta`/`kn` hint, detect language from Unicode script ratios (never a model), classify by rules and ask the `classify_document` task only below 0.8, render, persist in one transaction, emit.
- **Idempotency**: `document` is unique on `(workspace_id, source_capture_id, pipeline_version)`. The pipeline looks the document up first; a finished one is returned untouched. OCR calls carry a per-page idempotency key, so a retry reuses stored gateway results. A version bump (`PIPELINE_VERSION`) re-processes on demand only.
- **Status mapping**: `ready`, or `needs_you` with `unreadable` (empty scan, OCR under the confidence floor, unsupported file), `password_protected` or `corrupt`. When OCR is needed and AI is paused or over budget, the text-layer document is kept as `pending`, the capture stays `queued` and `source_meta.processingLater` drives the badge.
- **Sensitive / `ai_blocked`**: `ai_blocked` is read from the capture row. No OCR or model call is made; `text_status = 'skipped'` and `text_skipped_reason` records why. The gateway's own sensitive check is the backstop.
- **Near duplicates**: a 64-bit simhash of word trigrams is stored on the document. A Hamming distance at or under the threshold (default 3) emits `document.near_duplicate`; the pipeline never merges or deletes.
- **Search**: `document_page.search_tsv` is a generated `to_tsvector('simple', text)` column with a GIN index. `simple` keeps whole words, which suits Tamil and Kannada.
- **Events** leave through an injected `IntelligenceEvents` port after commit: `document.processed`, `capture.classified`, `document.near_duplicate`. The pipeline calls no other module.
- **Recovery copy** is the existing `inbox.unreadable.copy` key (#48 consumes it).
- Real Sarvam OCR quality for Tamil and Kannada is checked after deploy with the #113 credentials; tests use the `<file>.ocr.json` sidecar mock.

## Consequences

- Positive: text PDFs never reach a model; cost is bounded by the weak-page count.
- Negative: a rendered page costs memory; pages are rendered once and reused for OCR and the stored thumbnails.
- Follow-ups: merge or chain of near duplicates at L3 (automation engine), extraction (#46) and cause-list ingestion (#57) subscribe to the events.
