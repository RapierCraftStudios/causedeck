# Adapter fixtures

Golden fixtures for the court adapters (#371, [ADR 0015](../../../docs/adr/0015-court-adapter-framework.md)).
`src/testing/golden.ts` (`runGolden(adapterId)`) parses every listed input with the adapter and
compares the result with its expected file.

## Layout

```
fixtures/<adapter-id>/
  manifest.json
  <name>.input.txt | <name>.input.html | <name>.input.pdf | <name>.input.eml
  <name>.expected.json
```

- Every `<name>.input.*` has a `<name>.expected.json`: the adapter's `ParsedCauseList` for that
  input, read with `receivedAt` `2026-10-21T04:00:00.000Z` and the adapter's first forum code
  (or the entry's `forumCode`).
- `.txt` is read as text (pages split on form feeds), `.html` through `layoutFromHtml` and `.pdf`
  through `layoutFromPdf`. `.eml` is a forwarded email (#396): the adapter gets the raw message
  as a `kind: 'email'` input, and anchors are checked against `layoutFromEmail`'s pages (one per
  message: `Subject:` and `Date:` lines, a blank line, then the decoded body).
- `manifest.json` lists every input file:

  ```json
  {
    "adapter": "echo",
    "classification": "FICTIONAL",
    "fixtures": [
      {
        "file": "list-01-admission.input.txt",
        "kind": "cause_list",
        "origin": "synthetic",
        "classification": "FICTIONAL"
      }
    ]
  }
  ```

  `kind` is `cause_list`, `order` or `registry_notice` (#398). The golden runner parses and scores
  `cause_list` entries only: their expected file is the adapter's `ParsedCauseList`. An `order`
  entry's expected file is `{"header": ParsedOrderHeader, "cues": DirectionCue[]}` (the adapter's
  `parseOrderHeader` and `findDirectionCues`) and a `registry_notice` entry's is
  `{"events": RegistryEvent[]}`; the adapter's own fixture test checks them
  (`src/madras-hc/fixtures.test.ts`).

  `origin` is `synthetic` (generated or hand-written, every name fictional and flagged
  `FICTIONAL`) or `lawyer-supplied`. An input file the manifest does not list fails the run.

## What the runner reports

For each fixture it reports a readable diff (`rows[2].caseType: expected "WP", got "WA"`) and
every anchor whose quote is not verbatim in its page's text. For the set it reports a per-field
precision/recall table over `listDate` and the row fields. Rows are aligned by their anchor (page
and quote).

```sh
pnpm --filter @causedeck/adapters test:golden
```

## Synthetic fixtures

`src/testing/synthetic.ts` has seeded generators (`mulberry32`): the same seed always gives the
same bytes. `writeSyntheticPdf` writes text-layer PDFs with `pdf-lib`. Court-faithful generators
come with each adapter (#36, #37, #38).

To regenerate an expected file after a deliberate parser change, write the adapter's output for
the input to `<name>.expected.json`, then review the diff before committing.

## Madras HC fixtures

`in.tn.madras-hc.principal/` (#396) holds 12 synthetic cause lists (`list-*`: appellate-side
writs, division-bench writ appeals, Original Side, Commercial Division, supplementary, criminal
side, a `(MD)` list, a multi-page list with repeated headers and a row split across pages, an
OCR-noisy list, a "no cases" list, an HTML list with unknown headings, `No./of` and slash
variants) and 5 AIMS emails (`email-*`: plain, HTML table, Gmail forward, Outlook forward,
PDF-only), next to the 12 orders (`order-*`) and 5 registry notices (`registry-*`) of #398. The
list and email layouts are assumptions from parent #36, not observed documents; real lists and
emails are checked with #119.

## Karnataka HC fixtures

`in.ka.karnataka-hc.bengaluru/` (#408) holds 12 synthetic cause lists (`list-*`): 11 saved HTML
list pages (a daily Bengaluru list with 3 halls and 2 lists each, advance, supplementary,
Dharwad-style 100xxx numbers, no advocate columns, heading variants, "Orders (registry
objections)", reflowed multi-line headings, broken HTML, a sitting-list page read as
`not_a_cause_list` with zero rows, an empty list) and one consolidated column PDF
(`list-02-consolidated.input.pdf`). It also holds 12 orders (`order-*`: `KHC`, `KHC-D` and `-DB`
citations, interim with a relative date, call-on date, reserved, common order, decoy date, no
next date, writ category, RFA/RSA, 22 pages, scrutiny objections) and 4 FR / objection notices
(`registry-*`). Their expected files are checked by `src/karnataka-hc/fixtures.test.ts`, in
`test:golden`. The layouts are the ADR 0019 assumptions, not observed documents. The broken-HTML
input is in `.prettierignore`, so it stays malformed.

`pnpm --filter @causedeck/adapters gen:fixtures --adapter karnataka --seed 7` writes the seeded
Karnataka set (HTML and PDF lists, orders, notices, with truth files) to the git-ignored
`fixtures/generated/`, and `test:metrics` gates the adapter on it.

## Lawyer-supplied fixtures are never committed

Real lists and orders stay on the machine of whoever holds them. Put them in a `fixtures-private/`
directory (git-ignored anywhere in the repo) or any other directory, using the same
`<adapter-id>/` layout with `origin: lawyer-supplied`, and point `ADAPTER_PRIVATE_FIXTURES_DIR`
at it:

```sh
ADAPTER_PRIVATE_FIXTURES_DIR=$PWD/fixtures-private pnpm --filter @causedeck/adapters test:golden
```

The runner reports them as a separate set, so they never change the committed counts. CI never
sets the variable and never needs private fixtures. The real-fixture acceptance gate (at least 30
lists and 50 orders per High Court) is #119.
