# 0021. Capture inbox and upload pipeline

## Status

Proposed

## Date

2026-10-22

## Context

Every capture channel (share sheet, in-app upload, voice, camera, email, ICS, WhatsApp export, bulk import, typed note) lands in one inbox first as an L1 capture: the raw input is stored and nothing is interpreted (PRD CA-1..CA-4, CA-9, CA-10; docs/product/09 §3, §5, §8). Capture is the trust boundary of the product: nothing is read before it is sniffed, size-checked, scanned when scanning is enabled and de-duplicated, uploaded PDF JavaScript is never executed, and channels are off until the lawyer enables them with a plain-language note on where data goes. The storage layer (#217) already owns presigned uploads, magic-byte sniffing and the `blob` row; the job framework (#15) owns retries and dead-lettering.

## Decision drivers

- One upload path. A second sniffer or a second key scheme would let capture and `/api/uploads` disagree about what a file is.
- The web and API processes never open, render or execute a document during capture. Bytes are hashed, sniffed by magic number and streamed to a scanner, and that is all.
- Scanning is optional at Stage A and required at Stage B, so the same code runs both.
- Audit goes through the core writer, and packages may not import `@causedeck/core`.
- Sensitive matters (CA-10) must stay out of AI processing even if a job payload is hand-built.

## Considered options

| Option                                                                                 | Verdict  | Reason                                                                                                       |
| -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| Capture rides storage's `createUploadIntent` / `finalizeUpload` and records `blob.key` | Chosen   | Reuses sniffing, hashing, per-workspace keys and RLS; the capture row adds channel, status, dedupe and TTL   |
| A separate `workspace/{id}/captures/{captureId}` key scheme and a capture-only sniffer | Rejected | `keys.ts` builds keys server-side only; a second scheme bypasses key parsing and the tenant checks           |
| Pure rules and scanners in `@causedeck/capture`, DB-bound services in `core/capture`   | Chosen   | Core already depends on storage and owns audit; the package stays dependency-light and testable without a DB |
| All services in `@causedeck/capture`                                                   | Rejected | The package could not write audit events                                                                     |
| `system.capture.retention` lists workspaces, `capture.retention` sweeps one workspace  | Chosen   | The job framework requires a workspace payload except for `system.*` jobs; matches `audit.verify`            |
| One global `capture.retention {}` job                                                  | Rejected | `capture` is under FORCE RLS; a global job would need to widen the app role                                  |

## Decision

- **Tables.** `capture` (channel, status, `raw_storage_key` = the blob key, sha256, mime, size, original filename, `source_meta` with the status `history`, `dedupe_of_capture_id`, `matter_hint_id`, `ai_blocked`, `scan_status`, `pinned`, `ttl_at`, creator and timestamps) and `workspace_capture_channel` (enabled, who, when, `disclosure_version`) in migration 0053, both under FORCE RLS. `document.source_capture_id` gains its composite FK. The links use `ON DELETE SET NULL (<column>)` so `workspace_id` is never nulled. `app_capture_retention_targets` lists the workspaces with expired raw objects, ids only.
- **Type.** The allow-list entry is found from the extension and the declared MIME (`findAllowedType`); the bytes sniffed at complete must be a type that entry accepts. A mismatch is `UnsupportedTypeError`. WebP joins the storage allow-list; `.opus` rides the `ogg` entry.
- **Size.** Caps are capture config with the issue defaults (PDF 50 MB, image 20 MB, audio 25 MB, DOCX 25 MB, ICS 1 MB, TXT 5 MB, ZIP 100 MB), overridable by `CAPTURE_MAX_BYTES_<TYPE>`. They are checked against the declared size at presign (and by the signed content length), and against the stored size at complete. An oversized object is deleted and the capture is `failed` with reason `too_large`. Storage's own, looser caps still apply underneath.
- **Presign.** `POST /api/captures/presign` returns a PUT bound to the key, type and length. Storage's URL lifetime stays 5 minutes by default; capture asks for 10 minutes through a new option capped at 600 seconds. `POST /api/captures/:id/complete` re-reads the object, sniffs it, recomputes the sha256 and compares it with the client's, then moves the capture to `scanning` (a scanner is configured) or `queued`. `POST /api/captures` is a multipart fallback for the share target up to 10 MB that uses the same flow.
- **De-duplication.** Within a workspace, a verified sha256 that matches another open capture (not discarded, failed, quarantined or already a duplicate) makes the new one `duplicate` with `dedupe_of_capture_id`; its object is deleted. An advisory lock per workspace and hash makes two concurrent completes yield one processable capture.
- **Scan.** `ScanProvider.scan(stream)` returns `clean`, `infected`, `error`; the no-op scanner returns `skipped` (Stage A) and `ClamAvScanner` speaks clamd `INSTREAM` over TCP. `CAPTURE_SCAN_REQUIRED=true` turns `skipped` into a failure. An infected capture is `quarantined`: its object is copied to the `quarantine` kind prefix, the original deleted, the blob marked `infected` (so downloads are refused) and no job is enqueued. A scanner error throws so the job retries.
- **No execution.** No capture code imports a PDF library. A polyglot PDF with embedded JavaScript is accepted as data; a test pins that and that no capture source imports a renderer.
- **Channels.** Only `manual` and `upload` start enabled. `enableChannel` needs `workspace.manage` and the current `CAPTURE_DISCLOSURE_VERSION`, stores it, and audits fail-closed. `createCapture` for a disabled channel throws `ChannelDisabledError`.
- **Sensitive matters.** A hint at a `sensitive` matter sets `ai_blocked`; bulk import refuses it. `capture.process` reads `ai_blocked` from the row, not the payload, and the flag is only ever set, never cleared, by the capture code.
- **Status machine.** `received → scanning → queued → processing → ready | needs_you | failed` (plus `received → queued` when scanning is skipped, `needs_you`/`ready → applied`, and `discarded` from any open state). `duplicate`, `quarantined`, `discarded` and `applied` are terminal. Illegal moves throw, and each move appends `{from, to, at, reason?}` to `source_meta.history`.
- **Jobs.** `capture.scan`, `capture.process`, `capture.retention` and the daily 02:00 IST `system.capture.retention`. Payloads are ids only; singleton per capture and hash (scan) or pipeline version (process). Five attempts with exponential backoff; when they run out the capture is marked `failed` with a user-safe reason in its own transaction. `capture.process` claims the capture (`queued → processing`) and reports whether AI steps may run; the pipeline itself is #45.
- **Retention.** Audio raw expires 30 days after capture, forwarded raw text 30 days after extraction unless pinned (`setExtractionTtl`, called by #54), and a discarded capture is due at once, so the daily sweep deletes it within 24 hours. The sweep deletes the object and the blob row and nulls `raw_storage_key`; derived data stays.
- **Permissions and audit.** No new policy actions: files use `document.write`, channels `workspace.manage`; discarding or pinning another member's capture needs `workspace.manage`. Audit actions `capture.created`, `capture.completed`, `capture.discarded` (informational) and `capture.quarantined`, `capture.channel_enabled`, `capture.channel_disabled` (security, fail-closed) carry ids, channel, MIME and size, never a filename or content.
- **Typed notes.** `createManualCapture` stores the note as a plain-text object and queues it without a scan; the same sensitive and TTL rules apply.

## Consequences

- Positive: one trust boundary for every channel; Stage A and Stage B differ only by configuration; capture and uploads cannot disagree about a file's type.
- Negative: sha256 is verified by storage reading the whole object into memory (up to the cap, 100 MB for ZIP); a streaming hash would need a storage change. Until the pipeline (#45) lands, a claimed capture stays `processing`. `CAPTURE_*` settings are read from the process environment, outside the typed env schema.

## Revisit when

- The document pipeline (#45) takes over `capture.process` and sets the terminal states.
- Objects regularly approach the caps and the in-memory hash becomes a cost: stream the hash.
- A real ClamAV runs in production (Stage B) and its INSTREAM limits or timeouts need tuning.

## Links

- [Technical architecture spike](../engineering/13-technical-architecture-spike.md) §2, §4.2, §6
- [Core domains](../engineering/core-domains.md)
- Issues: #43 (this), #21 and #217 (storage), #32 and #349 (matter graph), #15 (worker), #45 (pipeline), #48 (inbox UI), #50 to #55 (channels)
