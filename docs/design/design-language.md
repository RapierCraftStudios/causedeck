# CauseDeck design language

CauseDeck is calm, precise, editorial-grade legal software. Advocates read it all day, often on a
phone between hearings, so it should look like good paper: quiet, consistent, and easy to trust.
The look comes from restraint and consistency, not decoration.

This document explains the reasoning. The values live in `packages/ui/tokens/*.css`, are listed in
`packages/ui/tokens/TOKENS.md` (generated), and are on show in `packages/ui/tokens/reference.html`
(open it in a browser and use the theme toggle). Spec source: technical spike §7
(`docs/engineering/13-technical-architecture-spike.md`) and issue #7.

## Principles

1. **Paper, not glass.** Surfaces are warm, matte and quiet. Depth comes from hairlines and soft
   two-layer shadows, never heavy blur, gradients, grain or texture.
2. **One accent, used rarely.** Deep indigo marks the primary action and links. Because nothing
   else competes, a single indigo button is enough to show the next step.
3. **The serif carries meaning, the sans carries interface.** Newsreader sets matter titles, brief
   prose and headings. Geist sets controls, labels, tables and navigation.
4. **Density with air.** UI text is 13 to 14 px on a 4 px grid, with tight line-length but generous
   space between sections.
5. **Dark mode is a night reading mode.** It uses ink-blue surfaces stepped by lightness, not
   inverted white. Both themes are first-class and both pass the same contrast gates.

## Colour

- Components use **semantic roles only** (`--surface`, `--ink`, `--accent`, ...). Primitive ramps in
  `primitives.css` exist for building roles, not for components.
- All colour is **OKLCH**. Hex and `rgb()` are not allowed. An sRGB fallback may appear only inside
  `@supports not (color: oklch(0 0 0))`. A test enforces this.
- **Contrast gates** (`pnpm --filter @causedeck/ui check:contrast`, also run in CI as a test):
  - body text is at least 4.5:1, and in practice at least 7:1 (AAA) on every surface;
  - other text is at least 4.5:1;
  - focus ring, form-control boundaries, marks and chart series are at least 3:1.
- The ring must clear 3:1 against both surfaces it can sit between (`--surface` and
  `--surface-raised`).
- `--line` and `--line-strong` are decorative hairlines. Form controls use `--line-control`, which
  meets 3:1 so an empty input is still visibly an input.
- `--seal` (brass) means provenance: a date or order verified from a court source. Do not use it
  for decoration.
- **Proceeding stages** (`--stage-*`) share one lightness per theme and differ by hue, so no stage
  looks more urgent than another. Urgency is a separate signal.
- **Automation levels** run from L1 (neutral) through L2 (amber-leaning) and L3 (indigo) to L4
  (brass).
- **Chart series** vary in lightness as well as hue, so every pair stays distinguishable under
  protanopia, deuteranopia and tritanopia (tested).

**Colour is never the only carrier of meaning.** A stage chip always shows the stage name. A status
always has a word or an icon. A chart always has a legend or direct labels.

## Typography

| Use                                   | Face                   | Notes                                       |
| ------------------------------------- | ---------------------- | ------------------------------------------- |
| Interface, labels, tables             | Geist (400-600)        | 14 px app default, labels 500 at -0.005em   |
| Matter titles, headings, brief prose  | Newsreader (opsz 6-72) | headings 500, optical sizing on, prose 16px |
| IDs, case and diary numbers           | Geist Mono             | tabular, slashed zero                       |
| Tamil, Kannada                        | Noto Sans Tamil/Kannada | loaded only when the text appears           |

- The scale steps by 1.2: 12, 13, 14, 16, 18, 22, 28, 36, 56 px. Steps from `lg` up grow fluidly
  between 360 and 1280 px viewports. Sizes are in rem so text scales to 200% without loss.
- Prose measure is at most 68ch.
- Eyebrow labels are 11/16, uppercase, tracked 0.06em, in `--ink-subtle`.
- **Numerals are tabular by default** in `.num`, tables, `<time>`, and INR amounts (`.inr`,
  `[data-inr]`), so columns of dates and rupees line up.
- **Tamil and Kannada**: line-height is 0.15 higher (body becomes 1.72), there is never negative
  tracking and never an uppercase transform, and weight stays between 400 and 500. Conjuncts and
  vowel signs need the room.
- Fonts are self-hosted WOFF2 files with metric-matched fallbacks, so swapping fonts does not shift
  layout. No request ever goes to Google Fonts or another third-party origin. The critical Latin
  payload is under 120 KB.

## Space, shape and depth

- **Spacing** is a 4 px grid (`--space-1` = 4 px up to `--space-24` = 96 px).
- **Radius**: 4 / 6 / 8 px for small parts and controls, 12 px for cards, 16 px for sheets, plus full.
- **Elevation**: `shadow-1` is a hairline, `shadow-2` is a card on hover, `shadow-3` a popover,
  `shadow-4` a dialog. In dark mode a surface rises by stepping lighter, plus a 1 px top-edge
  highlight.
- **Stacking** uses names only (`--z-sticky` up to `--z-tooltip`). A numeric z-index in a component
  fails a test.

## Motion

Motion should be quick and calm, and should explain what happened rather than decorate.

| Purpose                         | Duration                           | Token                                 |
| ------------------------------- | ---------------------------------- | ------------------------------------- |
| Feedback (press, toggle, hover) | 80-150 ms                          | `--dur-instant`, `--dur-fast`         |
| Content and panels              | 200-250 ms                         | `--dur-base`, `--dur-slow`            |
| Page-level                      | 320 ms at most                     | `--dur-page`                          |

- Animate only `opacity` and `transform`, plus `background-color` on hover.
- Easing: `--ease-standard` by default, `--ease-enter` and `--ease-exit` for elements appearing and
  leaving, and `--ease-spring` (sampled from the `motion` spring with stiffness 420 and damping 34)
  for direct manipulation.
- With `prefers-reduced-motion: reduce`, every duration becomes 0.01ms and transforms are switched
  off through `--motion-transform`.

## Do and don't

| Do                                                         | Don't                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| Use one indigo primary action per view                     | Put indigo on several competing buttons                 |
| Show depth with hairlines and the shadow scale             | Use gradients, glass blur, grain or textures            |
| Pair every status colour with a word or icon               | Rely on colour alone (red row, green dot)               |
| Use the serif for titles and brief prose                   | Set dense tables or form labels in the serif            |
| Keep focus rings visible (`:focus-visible`)                | Remove outlines or restyle focus away                   |
| Use semantic tokens and Tailwind utilities from the preset | Write hex, `rgb()`, raw ramps or numeric z-index        |
| Give touch targets at least `--hit` (44 px)                | Ship icon buttons smaller than 44 px on touch           |
| Write Tamil and Kannada at weight 400-500                  | Uppercase, tighten or bold Indic text                   |

## Copy tone

Plain, calm and respectful, in Indian-English legal register. Prefer the words advocates already
use: "Next date", "Listed", "Part-heard", "Needs you", "Filed", "Defects returned". No exclamation
marks, no playful jargon, no blame ("Couldn't fetch the cause list" rather than "You entered a wrong
number"). Dates are written `12 March 2026` in prose and `12-03-2026` in tables; amounts are
`₹ 1,25,000.00` with Indian digit grouping.

## Accessibility

- WCAG 2.2 AA everywhere, AAA for body text where feasible (currently everywhere).
- There is one global focus style: a 2 px `--ring` outline with a 2 px offset, never removed. Pointer
  focus (`:focus:not(:focus-visible)`) stays quiet.
- In forced-colours mode (Windows High Contrast), `--ring` maps to `Highlight` and the accent maps
  to `LinkText`.
- Touch targets are at least 44 x 44 px (`--hit`, applied to buttons and inputs on coarse pointers).
- Text must survive 200% zoom: sizes are in rem and layouts must not use fixed heights for text.
- `color-scheme` is set in both themes, so native controls and scrollbars follow the theme.

## Print

`@media print` switches both themes to ink on white, removes shadows, and sets A4 pages with
`--print-margin` (18 mm). The Brief Sheet and other print views build on this.
