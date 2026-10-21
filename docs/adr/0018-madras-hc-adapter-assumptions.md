# 0018. Madras HC adapter assumptions

## Status

Proposed

## Date

2026-10-22

## Context

The Madras High Court adapter `in.tn.madras-hc.principal` (#36, split into #395, #396, #398 and #401) reads cause lists, AIMS emails, orders and registry notices that the lawyer supplies, or that the court itself sent them. It never contacts a court site ([ADR 0015](0015-court-adapter-framework.md)). Research could not open a real list, email or order, so the grammar the adapter reads is an assumption. The assumptions are encoded as versioned configuration ([ADR 0015](0015-court-adapter-framework.md)), with tolerant parsing, and tested against FICTIONAL synthetic fixtures. Real fixtures come from H13 ([#119](https://github.com/RapierCraftStudios/causedeck/issues/119)): 30+ lists and 50+ orders that lawyers collect. This ADR lists every unverified assumption, the step that retires it, and how the adapter's first version ships.

## Decision drivers

- Every grammar choice that no real document has confirmed is written down, with a test that retires it.
- Replacing an assumption is a config change and a new adapter version, never a silent parser edit.
- The parser is measured on more than the hand-written fixtures, with fixed gates in CI.
- No real litigant data enters the repository.

## Considered options

| Option                                                                      | Verdict  | Reason                                                                                                                                                           |
| --------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship the assumed grammar as config, gate on synthetic data, verify with H13 | Chosen   | The adapter works now, every guess is listed and reversible, and real fixtures retire guesses one by one                                                         |
| Wait for real fixtures before building the adapter                          | Rejected | Blocks the court layer on a human collection task for an unknown time                                                                                            |
| Gate CI on lawyer-supplied fixtures                                         | Rejected | They can't be committed or put on a CI runner ([#371](https://github.com/RapierCraftStudios/causedeck/issues/371)); CI never sets `ADAPTER_PRIVATE_FIXTURES_DIR` |

## Decision

### Assumptions and their H13 validation

Each row is unverified until H13 retires it. The validation step is the same for every row. Put the lawyer-supplied documents in a directory with the committed layout (`<dir>/in.tn.madras-hc.principal/manifest.json`, `<name>.input.*`, `<name>.expected.json` written by hand from the real document). Then run `ADAPTER_PRIVATE_FIXTURES_DIR=<dir> pnpm --filter @causedeck/adapters test:golden` and read the private-set table for the row's fields. If the private set disagrees, change the config named in the row, bump the adapter version, add a synthetic fixture for the new shape, and activate the version with `activateAdapterVersion` (golden-gated).

| Assumption                  | What the adapter assumes                                                                                                                                                                                                                           | Encoded in                                                                                             | H13 check that retires it                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Heading names               | Stage headings are an open enum. `admission`, `orders`, `hearing`, `fresh`, `after_notice`, `part_heard`, `mentioning`, `supplementary` and `advance` are mapped, and any other heading is kept verbatim with `stageNorm: null`                    | `packages/adapters/src/madras-hc/config/stage-map.ts:6`; list-type markers `config/list-grammar.ts:12` | Every heading in 30+ real lists maps or is listed in `diagnostics.unmappedHeadings`; add any frequent unmapped heading |
| Item numbering              | Rows start with `1.`, `12A.` or `5(a)`; halls start with `COURT No. 12`; a bench line follows the hall                                                                                                                                             | `config/list-grammar.ts:6` (hall), `:9` (row), `:20` (bench)                                           | `itemNo` and `hallNo` precision and recall on the private set are at least the synthetic gates below                   |
| Case-line grammar           | `W.P.No.1 of 2026`, `WP No. 1/2026`, `W.P. No. 1 / 2026`, two-digit years, `(MD)` seat suffix, `and W.M.P.Nos.` children                                                                                                                           | `config/case-types.ts`, `packages/adapters/src/madras-hc/case-line.ts`                                 | `caseType`, `caseNumber`, `caseYear` and `matchKey` scores; `diagnostics.unknownCaseTypes` is empty                    |
| Per-row advocate fields     | One advocate line per row after the parties. Petitioner and respondent advocates are split on `/` (or `;`). Enrolment numbers print as `MS/123/1990`. A line opening with an `M/s` firm may be a party                                             | `config/list-grammar.ts:36-40`; `parse-cause-list.ts:134`; `advocates.ts`                              | Advocate splits and enrolment numbers on real lists match the hand-written expected files                              |
| AIMS email layout           | The subject picks the profile. `tagged cases` is a hall/item/case/parties/advocates table, `cause list` is text in the list grammar, `(pdf)` is PDF-only. The list date comes from `for`/`dated`/`on dd.mm.yyyy`. Forwarded wrappers are unwrapped | `config/email-profiles.ts:33` (date), `:43` (profiles)                                                 | Real AIMS emails (Notification 230/2026) parse with a profile; a new template becomes a new profile                    |
| Citation separator          | The neutral citation is `YYYY:MHC:n` or `YYYY/MHC/n`; both are read and normalised to colons                                                                                                                                                       | `packages/adapters/src/madras-hc/neutral-citation.ts:7`                                                | The separator printed on real judgments since 2023; drop the unused form                                               |
| Order header and next dates | The order date follows `DATED`, `Date of order` or `Pronounced on` before the `ORDER` title. A next date is read only from `Post on`, `Call on` or `List on` followed by a printed date. Dates after `order dated` are earlier orders              | `config/order-cues.ts`; `order-header.ts:55-58`                                                        | `orderDate` accuracy and zero invented dates on 50+ real orders                                                        |

The real-fixture run is reported separately: the golden report prints the private set as its own table and never mixes it with the committed counts. It is not required for merge, and CI never runs it.

### Synthetic generator and golden metrics

`packages/adapters/src/madras-hc/synthetic/generate.ts` builds seeded, FICTIONAL documents in the grammar above: cause lists (text, and one in five as pdf-lib PDFs through `writeSyntheticPdf`), AIMS emails (plain and HTML table), orders and registry notices. Each document comes with its truth: rows, list date, order date and every printed or derived date. `pnpm --filter @causedeck/adapters gen:fixtures --adapter madras --seed 7` writes 30 lists, 10 emails, 50 orders and 10 notices to the git-ignored `packages/adapters/fixtures/generated/`. The same seed gives the same bytes.

`packages/adapters/src/madras-hc/generated-metrics.test.ts` (`test:metrics`) parses seed 7 and gates the parser:

- list-row precision >= 99.5% (a row counts only when every scored field equals a truth row);
- recall >= 95%;
- order-date accuracy >= 98%;
- zero invented dates (every date the adapter emits is printed in the document, or derived from a printed date and period).

CI runs `gen:fixtures` and `test:metrics` as the "Adapter golden metrics (generated)" step, next to "Adapter golden fixtures". The generator stays inside the documented grammar: if a gate fails, fix the parser or the generator, and never lower a gate.

### First version

Migration `0048_madras_adapter_v1` registers `adapter_version` `in.tn.madras-hc.principal` `1.0.0` as `active`. Its config is the canonical `MADRAS_HC_CONFIG` and its checksum is that config's sha256 (`configChecksum`). The insert is idempotent and skipped when an active version already exists. `packages/adapters/src/madras-hc/adapter-version.test.ts` pins the row to the bundled config, so the loader never refuses it. `fixtures_digest` and `last_verified_at` stay empty; `activateAdapterVersion` records them when a later version is activated. The Principal Seat forums are already A1 in the forum catalogue seed.

## Consequences

- Positive: the adapter is usable on lawyer-supplied documents now, every guess is listed with the check that retires it, and parser regressions fail CI on 500+ generated rows.
- Positive: the version row lets the loader serve the config from the database, and later versions change it through golden-gated activation.
- Negative: the generator and the parser share the same assumptions, so the synthetic gates prove consistency, not correctness against real documents. Only H13 proves that.
- Negative: a config change now needs a new adapter version, because the migrated `1.0.0` row is pinned to the bundled config.

## Revisit when

- H13 (#119) delivers real Madras lists, emails or orders: run the private set and retire or change each row above.
- The court publishes a new AIMS email template or list format.
- A private-set score falls below a synthetic gate.

## Links

- [ADR 0015: court adapter framework](0015-court-adapter-framework.md)
- [ADR 0014: forum catalogue and deep links](0014-forum-catalogue-and-deep-links.md)
- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
