# Adapter fixtures

Golden fixtures for the court adapters (#371, [ADR 0015](../../../docs/adr/0015-court-adapter-framework.md)).
`src/testing/golden.ts` (`runGolden(adapterId)`) parses every listed input with the adapter and
compares the result with its expected file.

## Layout

```
fixtures/<adapter-id>/
  manifest.json
  <name>.input.txt | <name>.input.html | <name>.input.pdf | <name>.input.json | <name>.input.eml
  <name>.expected.json
```

- Every `<name>.input.*` has a `<name>.expected.json`: the adapter's `ParsedCauseList` for that
  input, read with `receivedAt` `2026-10-21T04:00:00.000Z` and the adapter's first forum code
  (or the entry's `forumCode`).
- `.txt` is read as text (pages split on form feeds), `.html` through `layoutFromHtml`, `.pdf`
  through `layoutFromPdf`, and `.json` is a `LayoutDocument` as a layout reader (or OCR, #45)
  would produce it ([ADR 0019](../../../docs/adr/0019-nclt-bengaluru-table-parsing.md)). `.eml` is
  a forwarded email (#396): the adapter gets the raw message as a `kind: 'email'` input, and
  anchors are checked against `layoutFromEmail`'s pages (one per message: `Subject:` and `Date:`
  lines, a blank line, then the decoded body).
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

`in.nclt.bengaluru` (#38) has its own generator, `src/nclt-blr/synthetic/generate.ts`. It draws a
table-format list as text runs and builds the `LayoutDocument`, a pdf-lib PDF and the ground truth
from them. Its 12 `.input.json` layouts and 4 rendered `-pdf.input.pdf` files are what the generator
produces for fixed seeds, and `src/nclt-blr/fixtures.test.ts` checks that. To regenerate them after
a deliberate change, run this from `packages/adapters`, then run Prettier and review the diff:

```sh
node --experimental-strip-types -e \
  "import('./src/nclt-blr/synthetic/generate.ts').then((m) => m.writeNcltFixtures())"
```

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
