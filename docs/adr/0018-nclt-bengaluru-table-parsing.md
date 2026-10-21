# 0018. NCLT Bengaluru cause lists: table parsing from word coordinates

## Status

Proposed

## Date

2026-10-21

## Context

NCLT Bengaluru publishes one cause-list PDF per bench per date. Unlike the High Court lists, the PDF is a true table: Sl. No., CP No., CA/IA No., Purpose, Section, Name of Parties, Counsel for Petitioner/Applicant, Counsel for Respondent, IRP/RP/Liquidator/MP and Remarks, under a coram and a hearing-mode notice (research/raw/09 §2.2, one 2023 list read). Matters are numbered `CP(IB) No. 132/BB/2022` (`BB` is the Bengaluru bench), and the IAs of a matter sit in the same row or in rows under it. NCLT is a secondary wedge for young corporate litigators (docs/strategy/11 §5) and moves from A0 to A1 with this adapter (#38). NCLT's terms of use have not been read, and counsel review (#118) gates any automated retrieval. The framework ([ADR 0015](0015-court-adapter-framework.md)) parses line by line and its ids, config and golden inputs did not cover a table format.

## Decision drivers

- Cell text in a table PDF only makes sense by position: one visual line mixes ten columns, and a cell wraps over several lines.
- Every row must be anchored on text that is verbatim on its page. Nothing may be guessed from an image-only PDF.
- Only the lawyer supplies documents. No link printed on a list is stored or followed.
- The column names, the header threshold and the x-tolerance must be versioned config that can be hot-deployed (#372), not code.
- Only one real list has been read, so fixtures are synthetic until #119 and every assumption is named.

## Considered options

| Option                                                                         | Verdict  | Reason                                                                                                         |
| ------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------- |
| Header synonym match plus x-gap clustering over word bboxes (`LayoutDocument`) | Chosen   | Uses the coordinates `layoutFromPdf` already gives; survives wrapped cells, reordered columns and small jitter |
| Line grammar (regexes over reading-order text), as in the echo adapter         | Rejected | Wrapped cells interleave on one text line; no regex can tell which column a word came from                     |
| Ruling-line (vector) table detection                                           | Rejected | Needs the PDF drawing operators, which the text-layer reader does not expose, and OCR layouts have none        |
| Slug adapter id (`nclt-blr`) instead of the catalogue id                       | Rejected | The forum catalogue and strategy doc already name adapters `in.nclt.bengaluru`; two vocabularies would drift   |

## Decision

- **Adapter.** `in.nclt.bengaluru` in `packages/adapters/src/nclt-blr/` (`createNcltAdapter`). Access modes: `cause_list` and `orders` `user_supplied`, `status` and `display_board` `none`. Migration 0047 records them in `access_mode_registry` with the note "NCLT T&C not yet read, counsel review pending (#118)". NCLT orders stay with the A0 generic adapter (#56).
- **Dotted adapter ids.** The adapter id is the forum catalogue's dotted form. Dotted ids came with #395 (`ADAPTER_ID_PATTERN`, `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$`, and `adapter_version_adapter_id_chk` in migration 0045), so this adapter needs no change to the rule.
- **Table config.** `AdapterConfigSchema` gains an optional, strict `table` section: `columns` (canonical key to header spellings), `minHeaderMatches` (default 5) and `columnTolerancePx` (default 6). It has no default, so configs without it keep their checksum. NCLT's is `src/nclt-blr/config/adapter.config.json`, built from `config/columns.ts` and `config/prefixes.ts`. Migration 0047 registers it as `adapter_version` 1.0.0, and a test pins the stored JSON and checksum to the code.
- **Header.** Words are grouped into visual lines by their tops. A header is a line, or a line and the next one for wrapped header cells, whose x-gap clusters match at least `minHeaderMatches` known columns. Unmatched clusters are kept as extra columns and missing columns are recorded. A header repeated on any page is skipped, never emitted as a row. A cheap word screen runs before clustering.
- **Columns.** A body word belongs to the right-most column whose header starts at or left of it, less the tolerance. A word that runs past the next header's start by more than the tolerance makes its line unassignable. That line goes to `unparsedRows` with its anchor, never into a guessed cell.
- **Rows.** A line opens a matter when its CP cell holds a matter number, or when it has a serial and CP text. Every other body line continues the row above it: wrapped cell text is joined in reading order, and IA/CA/MA numbers become `children[]` with their own purpose and section when the line has them. Several numbers in one cell, comma- or newline-separated, are all children. Parties split on the first `Vs`, `V/s` or `versus`. Counsel stay raw strings, split on commas, with deterministic alias spellings in the shared `AdvocateSchema` convention (upper case, titles stripped, initials split and run together; no transliteration). They surface as `advocates[]` on the framework's `ParsedListRow` too, with the optional `side` (`petitioner` or `respondent`) that this ADR adds to `AdvocateSchema`.
- **Metadata.** Lines before the header, and lines that start in the first column with a coram or hearing phrase, give the list date, the coram (`bench`), the hearing mode (`physical`, `video_conference`, `hybrid`) and the time. Each coram starts a bench section. A link only sets `hasVcLink`, and URLs are stripped from every stored string and anchor.
- **Anchors and OCR.** Each row is anchored on its first line, quoted verbatim from the page text, with the bbox of its lines. A document whose pages all have `textCoverage` 0 returns `status: needs_ocr` and no rows. `needs_ocr` joins `ok`, `empty` and `failed` in `PARSE_STATUSES`, and the adapter reports `ok`, or `empty` for a list without rows. The caller OCRs it (#45) and runs the same parser on the OCR layout.
- **Two result layers.** `parseNcltCauseList` returns the full `NcltCauseList` (`NcltRow` with children, counsel, RP, remarks, bench sections and unparsed rows). The adapter maps it to the framework's `ParsedCauseList` for the golden harness and parse health, with anchored unparsed rows in its `unparsedRows`. Bench sections become `hallNo` `1`, `2`, and so on, and `BB` becomes the seat suffix (`CPIB(BB)/132/2022`).
- **Fixtures and metrics.** A seeded generator (`synthetic/generate.ts`, test tooling) draws lists as text runs. It builds the `LayoutDocument` the PDF reader would produce, a pdf-lib PDF and the ground truth. 12 layout fixtures (`.input.json`, a new golden input kind) and 4 rendered PDFs are committed, all FICTIONAL. On 20 seeded lists, rows must reach precision ≥ 99.5% and recall ≥ 95%, nested-IA attachment must be 100%, and ±3 pt jitter must parse exactly. A 30-page list parses in under 400 ms (median of 5).
- **Level is data.** Migration 0047 and the catalogue seed set the forum's `adapter_level` to A1. No code branches on the forum code.

## Consequences

- Positive: a table-format forum is config plus a generic table reader that other tribunals can reuse. Every row is anchored, and nothing is guessed from scans.
- Negative: the column and prefix sets, merged cells and multi-bench PDFs are assumptions until real lists arrive (#119). Left-aligned headers are assumed: centred header text would need a different column start.

## Revisit when

- Lawyer-supplied lists (#119) show header spellings, prefixes, centred headers or merged cells the config cannot express, or the golden metrics drop on them.
- Counsel's review of NCLT's terms (#118) clears a retrieval mode for the list.
- Another tribunal needs the table reader, which then moves out of `nclt-blr/`.

## Links

- [ADR 0015](0015-court-adapter-framework.md)
- [ADR 0014](0014-forum-catalogue-and-deep-links.md)
- [ADR 0011](0011-access-mode-registry-closed-enum.md)
- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
- Issues: #38 (this adapter), #35 (framework), #45 (OCR), #56 (A0 generic), #42 (courts area), #118 (counsel review), #119 (real fixtures)
