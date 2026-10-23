# 0030. Diary-photo capture and image-region anchors

## Status

Proposed

## Date

2026-10-23

## Context

PRD CA-6 and CA-1 (docs/product/09 §3, §4.4, §5, §8) let a lawyer photograph a paper diary page and get confirmable proposals without retyping. Handwriting OCR in Tamil and Kannada is imperfect, so the contract is conservative: every proposal is L2 (an undated task is L3 only at confidence >= 0.8, as for any task), every field is anchored to the OCR line it came from, a date must literally appear in that line, and an unreadable page says so. The issue (#52) called this ADR 0026 and a migration `drizzle/<timestamp>`; 0026 and 0027 are taken and migrations live in `packages/db/migrations`, so this is ADR 0028 and migration 0060.

## Decision drivers

- A model may only cite, never invent: an entry without a real OCR line, or a date not written in that line, is dropped.
- A photo must survive a tab crash and never reach the network before it is on the device, encrypted ([ADR 0026](0026-pwa-share-target-and-outbox.md)).
- A sensitive-matter photo is kept as an attachment and never reaches the gateway.
- No new server surface and no new proposal kind.

## Considered options

| Option                                                              | Verdict  | Reason                                                                                                            |
| ------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| Pages held in the outbox, one multi-page PDF per batch on "Upload"  | Chosen   | One capture, one document, page order kept; the existing pipeline renders and OCRs each page unchanged            |
| One capture per photo, merged on the server by `batchId`            | Rejected | Needs a new merge step and a wait for the last page; partial batches would sit in the pipeline                    |
| Model returns boxes and dates; the server trusts them               | Rejected | A model can place a box or a date that is not on the page                                                         |
| Model cites numbered OCR lines; the server resolves anchor and date | Chosen   | The anchor is the line's own box and text; `datePresence` is a plain check on the cited line                      |
| Hearing outcome as a new `hearing_outcome` proposal kind            | Rejected | `PROPOSAL_KINDS` is closed on purpose (no-L5 contract); a note is a `task` draft with confidence capped under 0.8 |

## Decision

- **Capture (browser).** `getUserMedia({video:{facingMode:{ideal:'environment'}}})` when the sheet opens, a file input with `capture="environment"` as fallback, the gallery always. Each photo is cropped by four corners (client homography), downscaled to a 2000 px long edge, JPEG 0.85, EXIF applied, and written encrypted to the outbox with `hold` set, so it is never uploaded alone. "Upload" replaces the held pages with one PDF item (`channel=camera`, same `batchId`); originals upload only when the person keeps "Original". A blur and glare check (variance of the Laplacian) runs before upload.
- **Data.** Migration 0060 adds `document_page.ocr_lines jsonb` (`[{text, bbox [x0,y0,x1,y1] 0..1, conf}]`). The gateway `ocr` task and the Sarvam mapping carry optional line boxes; the pipeline persists them. Anchors use the existing `image_region` kind with a normalised `{x, y, width, height}` box.
- **Structuring.** `structureDiaryPage` numbers the OCR lines and sends them to `structure_diary`; entries cite a line number. `verifyDiaryEntries` resolves each to a line anchor and keeps a date only when `datePresence` finds it written (digits, English, Tamil or Kannada months, Indic numerals) in the cited line. A low-confidence page is `unreadable`; an `ai_blocked` capture never calls the gateway.
- **Proposals.** `diaryToProposalDrafts` yields `next_date` (L2) on a case number and year that match exactly one proceeding, notes as capped `task` drafts, `new_matter` (L2) for an unmatched reference with the lawyer's own words, and nothing attached to a matter without an identifier match. Two matching proceedings make an `ambiguous` card.
- **Routing.** A camera photo classified as a printed cause list, or a receipt, skips diary structuring and waits in Needs you (`source_meta.cameraRoute`); the list import hand-off arrives with #57 and fee tracking with #83.

## Consequences

- One PDF per batch means a single page cannot be retried alone after upload; Retake works before it.
- Real handwriting accuracy is not a merge gate; the synthetic eval (30 pages per language) guards date accuracy, zero hallucinated dates and anchor validity, and lawyer-supplied diary photos are a later human check.
- The camera channel stays opt-in per workspace (CA-9).

## Revisit when

- Lawyer-supplied diary photos show handwriting accuracy too low for the proposals to be useful, which would call for a different recognition provider.
- Single-page retry after upload is wanted, which would replace the one-PDF-per-batch upload.
