# 0039. The court-day board interaction model

## Status

Proposed

## Date

2026-10-25

## Context

`/today` and `/tomorrow` show a chamber's listed items by complex, hall and item number. The read model (ADR 0037) and the marker service exist; the board must work on a phone in a corridor, on a laptop and by keyboard alone, and must never predict when an item will be called.

## Decision drivers

- One board for both days, server-rendered, little client JavaScript.
- The hall in view must survive reload and back navigation.
- Every state (clash, change, failure, marker) is text plus an icon, never colour alone.
- The offline cache (#65) must slot in without touching the board.

## Considered options

| Option                                     | Verdict  | Reason                                                       |
| ------------------------------------------ | -------- | ------------------------------------------------------------ |
| Server components, hall choice in `?hall=` | Chosen   | Reload and back work with no client state; links, not script |
| Client tabs for the hall rail              | Rejected | State lost on reload; more JavaScript                        |
| Swipe between halls                        | Rejected | Conflicts with system gestures; not keyboard operable        |
| Predict the call time per item             | Rejected | Out of scope: the board states facts only                    |

## Decision

- One server-rendered `CourtDayBoard` serves both days; the IST day is computed once in `load-court-day.ts`.
- At phone width one hall shows with a sticky hall rail of links to `?hall=<id>`; from 768 px two columns; from 1280 px snapping columns with a right rail (carry list, needs-you). Below 1280 px the rail is a bottom `<details>` drawer.
- Keyboard: `j`/`k` item, `h`/`l` hall, `Enter`, `c`, `m`, `o`, `d`, `/`, `g t`, `g m`, `?`. Items use roving tabindex; plain keys are ignored while typing.
- "Court is at item N" persists through `setCurrentItemAction` (core `setCurrentItem`, `matter.write`); the rule and dimming come from the server render, so every chamber member sees it. No swipe gestures are bound; the quick-action sheet opens on long press, Enter or Space.
- `useCourtDayData` is the single seam for connection state and last-known data; #65 replaces its body.
- Carry toggling is read-only (derived carry count) until a core service and table exist.

## Consequences

- The board adds no core or database change.
- A failed hall read keeps the last known data on screen with an official-list link that opens in a new window and is never framed.

## Revisit when

- #65 lands the offline cache, or carry toggling gets a persisted model.
