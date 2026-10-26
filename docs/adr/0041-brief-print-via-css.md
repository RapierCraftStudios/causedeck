# 0041. Brief printing through a print stylesheet

## Status

Proposed

## Date

2026-10-25

## Context

The Brief Sheet (PRD PR-1) is read on screen and carried to court on paper. The printout must match the screen, fit two A4 pages, keep obligation rows and passages whole, and print ink on white in both themes. A headless-browser PDF service in production would add infrastructure and a second layout to keep in step.

## Decision drivers

- One layout for screen, print and the saved PDF.
- No new production service.
- Private court notes must not print unless the member opts in.

## Considered options

| Option                                     | Verdict  | Reason                                                          |
| ------------------------------------------ | -------- | --------------------------------------------------------------- |
| Print stylesheet and `window.print()`      | Chosen   | One source of layout truth; the browser's own Save as PDF works |
| Server-side headless browser renders a PDF | Rejected | New production service; a second layout to maintain             |
| Client-side PDF library                    | Rejected | Re-implements layout; poor Tamil and Kannada shaping            |

## Decision

`print.css` sets `@page` to A4 with 14 mm margins, avoids breaks inside statements, obligations and carry items, forces ink on white, and shows each Provenance Chip as short footnote text. 'Print / Save as PDF' sets the document title to `Brief - <case no.> - <date>` and calls `window.print()`. Court notes are hidden in print unless 'Include private notes when printing' is on; the choice is stored per member. CI renders the seeded long brief with Playwright `page.pdf` only to assert the result; production adds no headless browser.

## Consequences

- The printout depends on the browser's print engine; the CI PDF spec guards page count and margins.
- Layout changes for print are made in one file.

## Revisit when

- A server-side PDF is needed for sharing outside the workspace, or the browser print engines diverge from the CI PDF spec.
