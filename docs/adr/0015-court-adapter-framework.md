# 0015. Court adapter framework: no network, registry-enforced access, config versus parser

## Status

Proposed

## Date

2026-10-21

## Context

Court adapters turn cause lists, orders and case-status pages into rows the matter graph can use (PRD CL-2, CL-6, CL-7; [system architecture §5.1-§5.4](../product/10-lawyer-os-system-architecture.md)). Court data is legally sensitive: the product never scrapes court sites without authorisation and never circumvents a captcha ([ADR 0011](0011-access-mode-registry-closed-enum.md)). Each court prints the same facts differently: case types (`W.P.`, `WP`, `W.P.(MD)`), two-digit years, stage headings. Issue #35 asked for one framework that every concrete adapter (#36, #37, #38, #56) builds on. Issue #369 is part 1: the contract, config, registry, normalisers, access enforcement, the no-network rule and an echo adapter. Layout readers (#370), the golden harness (#371) and versioned config with parse-health monitors (#372) follow.

## Decision drivers

- An adapter must not be able to fetch court data on its own, by design and by CI, not only by review.
- A capability that counsel has not cleared must be unusable.
- Adding or fixing a court should mostly be a config change, not new parser code.
- Every parsed fact must point back to where it came from, and parsing must be repeatable.

## Considered options

| Option                                                                              | Verdict  | Reason                                                                                         |
| ----------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| Pure parsers over supplied documents, zod-typed, config-driven, lint-banned network | Chosen   | Legal posture is enforced by CI; courts differ in config; outputs are checkable and repeatable |
| Adapters fetch their own lists from court sites on a schedule                       | Rejected | Automated server-side retrieval without authorisation is ruled out (ADR 0011, PRD CL-6)        |
| One hand-written parser per court with no shared config or normalisers              | Rejected | Every fix is code; spellings and stages drift between courts; no shared diagnostics            |
| A closed enum of stages that rejects unknown headings                               | Rejected | Courts add headings without notice; a throw would lose a whole list over one new heading       |

## Decision

- **No scraping, no network.** `packages/adapters` only parses documents the lawyer supplied (upload, paste, forward, share). `packages/adapters/eslint.config.js` fails CI on any import of `node:http(s)`, `http2`, `net`, `tls`, `undici`, `axios`, `node-fetch`, `got`, `ky`, `puppeteer`, `playwright` (static, dynamic or `require`), a bare or `globalThis.` `fetch`, `XMLHttpRequest` or `WebSocket` inside `src`; a rule test proves each case. PDFs are parsed as data; JavaScript in them is never run.
- **Layout readers (#370).** `layoutFromPdf`, `layoutFromHtml` and `layoutFromText` in `packages/adapters/src/layout/` turn a supplied document into a `LayoutDocument`. The PDF reader uses `pdfjs-dist` on bytes only, never a URL: text layer only (`getTextContent`), XFA off, no font faces, no rendering, no annotation layer and no scripting sandbox, so document JavaScript (`app.alert`, open actions) is never run; pdfjs 6 no longer compiles fonts with `eval`. It is loaded with a dynamic `import()`, so importing the package (apps/web does) never pulls pdfjs in. Each page has its lines (`items`) and words (`words`) with top-left bboxes in PDF points, and a `textCoverage` (line area over page area); a page without a text layer reports 0 and the caller falls back to OCR (#45). HTML goes through `parse5`, which builds a tree and runs nothing; scripts, styles, templates and comments are skipped. Plain text splits into pages on form feeds.
- **No captcha.** No adapter code solicits or solves a captcha: the lint rule rejects identifiers and strings naming one, and a test scans every source file.
- **Access-mode registry enforcement.** `assertAccessMode(adapterId, resource, mode)` in `packages/adapters/src/access/enforce.ts` throws `AccessModeViolationError` (code `ACCESS_MODE_DENIED`) unless `access_mode_registry` has an enabled row for the adapter's resource whose mode equals the declared one. A declared or registered `none` always denies. `device_user_triggered`, `official` and `licensed` also need the row's counsel note; until counsel's memo (#118, unlocks #120) only `user_supplied` rows are enabled. It builds on `@causedeck/flags/access-mode`, which reads the registry once. Resources are `cause_list`, `orders`, `status` and `display_board`; modes are the frozen ADR 0011 list (`official`, never `official_feed`).
- **Config versus parser.** What differs between courts lives in a zod-validated `AdapterConfigSchema`: case-type aliases and seat suffixes, hall and row patterns, direction phrases, calendar, language profile, deep-link kinds, health thresholds, `stageMap` and the two-digit-year pivot. Parsers and normalisers are shared code. Stages are an open enum: an unmatched heading is kept verbatim as `{stageRaw, stageNorm: null}` and counted in `diagnostics.unmappedHeadings`; nothing throws on it.
- **Anchored, deterministic output.** Every `ParsedListRow` carries an anchor `{page, quote, rowIndex, bbox?}` whose quote occurs verbatim in the page text, and a confidence; a row that cannot be anchored is dropped and counted, never emitted. `parse*` functions are pure: the same input and config give byte-identical JSON. Non-matched rows are returned to the caller, which discards them (docs/product/09 §8.4); the framework stores nothing.
- **Parse failure.** A list the app cannot read becomes a typed `ListUnreadable {forumCode, hallNo?, deepLink}`, shown as "Couldn't read today's list for Hall X. Open the official list, or share it again." The link comes from `resolveDeepLink` (#34, [ADR 0014](0014-forum-catalogue-and-deep-links.md)) and opens in a new window; the caller passes it in because adapters may not import `core`.
- **Versioned config and parse health (#372).** Each config version is an `adapter_version` row (global: adapter id, semver, config jsonb, `draft|active|retired`, sha256 `checksum` of the canonical config JSON, `fixtures_digest`, activation and verification times); a partial unique index allows one `active` row per adapter. `activateAdapterVersion` (`packages/adapters/src/config/activate.ts`) refuses a row that does not validate or match its checksum, and any version whose adapter does not pass the committed golden fixtures (#371), judged as that version; otherwise it retires the old row and activates the new one in one transaction and invalidates the loader. The loader (`config/loader.ts`) serves the active row, or the config bundled with the code when there is none, from a 60 s cache, so every process picks up an activation within a minute without a restart. `evaluateParseHealth` (`health/monitor.ts`) flags `zero_rows` (`failed`), `yield_drop` (below 50% of the median of the last 7 runs for the forum), an unmapped-heading ratio above 0.2, an unknown-case-type ratio above 0.1 and `missing_hall_headers` (`degraded`), with the affected halls. `recordParseRun` stores metrics only (counts and hall numbers, never row text) in the tenant table `adapter_parse_run`; the `adapter_health_summary` view counts them per adapter and version across workspaces (through an owner-only read policy) and names no workspace. The database parts are in `@causedeck/adapters/server`; core reads the view with `getAdapterHealthSummary`.
- **Table-format adapters ([ADR 0017](0017-nclt-bengaluru-table-parsing.md)).** Adapter ids may be dotted slugs in the forum catalogue's form (`in.nclt.bengaluru`). `AdapterConfigSchema` has an optional `table` section (column spellings, header threshold, x-tolerance). `ParsedCauseList` may carry `status: needs_ocr` and rows may carry `advocates`, and the golden harness also reads `LayoutDocument` inputs (`.input.json`).
- **Fixtures.** The framework ships a three-list echo fixture set, all fictional and flagged `FICTIONAL`. Real-fixture sign-off (at least 30 lists and 50 orders per High Court) is a later human gate, #119; no adapter is called production-ready before it.

## Consequences

- Positive: the legal posture is checked by CI; a new court is mostly config; anchors make every parsed fact verifiable; diagnostics show drift before it hurts.
- Negative: anything that would need a live court connection cannot live in this package; a mode other than `user_supplied` stays off until counsel writes a note on its row.

## Revisit when

- Counsel's memo (#118) clears a `device_user_triggered`, `official` or `licensed` channel and its fetching code needs a home outside the parsers.
- A court publishes an authorised feed that needs a client library this rule bans.
- Golden fixtures (#371) or parse health (#372) show the config cannot express a court's format.

## Links

- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
- [ADR 0011](0011-access-mode-registry-closed-enum.md)
- [ADR 0014](0014-forum-catalogue-and-deep-links.md)
- [Feature flags guide](../engineering/flags.md)
- [ADR 0017](0017-nclt-bengaluru-table-parsing.md)
- Issues: #35 (adapter framework), #369 (this part), #38 (NCLT table adapter), #372 (versioned config and parse health), #118 (counsel memo), #119 (real fixtures), #120 (counsel unlocks)
