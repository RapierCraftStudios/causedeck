# 0018. Karnataka HC adapter: layout assumptions and how H13 retires them

## Status

Proposed

## Date

2026-10-22

## Context

The Karnataka High Court adapter `in.ka.karnataka-hc.bengaluru` (#37, part 1 #404) parses cause lists and orders the lawyer supplies for the Principal Bench at Bengaluru (A1, `packages/db/src/seed/forum-catalogue/karnataka-hc.ts`). It follows the framework rules of [ADR 0015](0015-court-adapter-framework.md): no network, access modes from the registry, court differences in versioned config.

The research could not open an output cause list, the sitting lists or the official case-type table (`casetypes.pdf`). The legacy NIC host refused every connection ([research/raw/09](../../research/raw/09-bengaluru-karnataka-court-ecosystem.md), fetch caveats and §6). The column layout, heading names, Bar Registration Number (BRN) format and numbering are therefore assumptions. Each one is captured as config or as a tolerant rule, tested on synthetic FICTIONAL fixtures, and retired by H13 ([#119](https://github.com/RapierCraftStudios/causedeck/issues/119): 30+ lawyer-supplied lists and 50+ orders per HC).

## Decision drivers

- Wrong guesses must degrade (unmapped heading, unknown type, diagnostic), never throw or invent data.
- Every assumption has to be changeable as an `adapter_version` config, without a code release.
- The adapter never fetches a URL, and none of the court's pages is read automatically.

## Considered options

| Option                                                 | Verdict  | Reason                                                                   |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------ |
| Ship assumptions as config with tolerant parsing       | Chosen   | Matches ADR 0015; real fixtures can retire each one with a config change |
| Wait for real fixtures before building the adapter     | Rejected | Blocks the A1 forum; H13 needs a lawyer and has no date                  |
| Retrieve sample lists from the court site to calibrate | Rejected | Fetching is out of scope for A1 and forbidden by the no-network lint     |

## Decision

The adapter ships version 1.0.0 (`packages/adapters/src/karnataka-hc/`, `adapter_version` row in migration 0048) with these assumptions, each listed with the H13 check that retires it:

| #   | Assumption                                                                                                                                                                                                                                                                                      | Where                                             | H13 check that retires it                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A1  | Column names: Sl No / Case No / Party Name / Petitioner Advocate / Respondent Advocate / Remarks (with synonyms). A row without advocate columns parses with `advocates: []` and an `advocate_columns_missing` diagnostic.                                                                      | `config/column-synonyms.ts`, `advocate-keys.ts`   | Header cells of 30+ real lists all map to a column, or the synonyms are extended in a new config version.         |
| A2  | Heading names: `FOR ADMISSION`, `PRELIMINARY HEARING`, `FOR ORDERS`, `FINAL HEARING`, `HEARING`, `FRESH`, `JUDGMENT`/`PRONOUNCEMENT`, `OFFICE OBJECTIONS`, `DICTATION`. Unmatched headings stay verbatim (open enum). List types: daily, supplementary, advance, special, entire; `LIST NO. N`. | `config/stage-map.ts`, `config/list-grammar.ts`   | `unmappedHeadings` is empty across the real lists after a stage-map update; list-type markers seen on every list. |
| A3  | BRN format is unverified: tolerant `[A-Z]{2,5}/\d{1,6}/\d{4}` (case and spaces around slashes ignored, e.g. `KAR/1234/2010`). It is the stable key in `enrolmentNo`; names keep raw text plus aliases with titles stripped and initials split, never transliterated.                            | `advocate-keys.ts`                                | Every BRN printed on a real list matches, and none of the matches is a false positive (dates, case numbers).      |
| A4  | Bracketed writ categories: a parenthesised code after the year, e.g. `W.P. No. 12345 of 2026 (GM-RES)`, is the `subCategory`; it never changes the case type or the match key.                                                                                                                  | `case-line.ts`                                    | Real writ lines and order headers show categories only in that position.                                          |
| A5  | 100xxx numbering: a number >= 100000 sets `benchNumbering: '100xxx'` as a hint only (research/raw/09 §6 links it to Dharwad and Kalaburagi). Numbers are opaque strings; nothing assumes a uniform sequence.                                                                                    | `case-line.ts`                                    | Real orders confirm or refute the bench link; the hint stays a hint either way.                                   |
| A6  | Case types: WP, WA, RFA, RSA, MFA, CRL.P, CRL.RP, CRL.A are `verified` (orders or dropdown); CRP, CCC, CP, WPCR, Comm.A.P and other common types are `verified: false`. Completeness is `partial`.                                                                                              | `config/case-types.ts`                            | The official `casetypes.pdf` is captured; the table is completed and completeness becomes `complete`.             |
| A7  | Access modes: `cause_list` and `orders` are `user_supplied`; `status` and `display_board` are `none`. `stageCodeLegend: {}` is reserved for the legally gated display-board work.                                                                                                               | `index.ts`, `AdapterConfigSchema.stageCodeLegend` | Not an H13 item: changes only with a legal sign-off and an access-mode registry change (ADR 0011).                |

Real-fixture results (`ADAPTER_PRIVATE_FIXTURES_DIR`) are reported separately and are not required for merge. The committed fixtures are FICTIONAL and synthetic (#408). Deep links open the court's cause-list, case-status and judgment pages in a new window from the forum catalogue; the adapter reads none of them.

The 1.0.0 row is inserted active by a migration with `fixtures_digest` null, because no KHC golden fixtures are committed yet. Every later version goes through `activateAdapterVersion` and its golden gate.

## Consequences

- Positive: the A1 forum has a registered adapter and config now. Each assumption is one config value or one rule that H13 can retire.
- Negative: until H13, parse quality on real lists is unknown. Unmapped headings, unknown types and missing advocate columns show up as diagnostics, not as data.

## Revisit when

- H13 (#119) delivers real Karnataka HC lists and orders.
- The Dharwad or Kalaburagi Bench is enabled (v2), which needs its own adapter config.
- Display-board access is legally cleared and `stageCodeLegend` gets content.

## Links

- [ADR 0015: court adapter framework](0015-court-adapter-framework.md)
- [ADR 0011: access-mode registry](0011-access-mode-registry-closed-enum.md)
- [research/raw/09: Bengaluru and Karnataka court ecosystem](../../research/raw/09-bengaluru-karnataka-court-ecosystem.md)
