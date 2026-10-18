# @causedeck/ui

CauseDeck's design system: the #7 design tokens, shadcn-style components built on Radix, hooks,
motion presets and Storybook. It is domain-free. It may import only `@causedeck/config` and
`@causedeck/validators` (boundary lint), never apps or domain packages.

```ts
import { Button } from '@causedeck/ui/button'; // per-component subpath: smallest bundle
import { Kbd, useHotkey } from '@causedeck/ui'; // or the package entry
```

Apps import the CSS once: `@import 'tailwindcss'; @import '@causedeck/ui/tokens.css';
@import '@causedeck/config/tailwind/preset.css';`. The package marks `sideEffects: ["**/*.css"]`,
so unused components are tree-shaken.

## Scripts

| Command                                          | What it does                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `pnpm --filter @causedeck/ui storybook`          | Storybook on :6006 (theme, viewport 360/768/1280 and locale en/ta/kn toolbars)   |
| `pnpm --filter @causedeck/ui build-storybook`    | Static Storybook in `storybook-static/` (published by CI as an artifact)         |
| `pnpm --filter @causedeck/ui test`               | Unit tests (node and jsdom); what turbo and CI `test` run                        |
| `pnpm --filter @causedeck/ui test:storybook`     | Every story as a browser test (play + axe, light and dark), reduced-motion tests |
| `pnpm --filter @causedeck/ui check:stories`      | Fails when a component lacks its stories, test or source file                    |
| `pnpm --filter @causedeck/ui check:bundle`       | Fails when a component adds more than 6 KB gzip, or `sideEffects` changes        |
| `pnpm --filter @causedeck/ui check:contrast`     | WCAG/APCA contrast of every allowed token pair                                   |
| `pnpm --filter @causedeck/ui test:visual`        | Screenshot every story against `visual/__screenshots__` (see Visual regression)  |
| `pnpm --filter @causedeck/ui test:visual:update` | Rewrite the baselines; run only inside the pinned Playwright image               |

`test:storybook` needs Playwright Chromium (`pnpm --filter @causedeck/ui exec playwright install
chromium`, once per machine; CI installs it in `.github/workflows/storybook.yml`).

The bundle check measures what a component adds on top of the shared runtime every consumer
already pays once: `cn` (clsx and tailwind-merge, about 8 KB gzip). React is external.

## Visual regression

`visual/` is a Playwright harness over the built Storybook. `visual/stories.ts` reads
`storybook-static/index.json` and screenshots every story (docs pages excluded) in light and dark
(the `theme` global) at 360, 768 and 1280 px wide, full page, with animations disabled, reduced
motion and a hidden caret. A screenshot fails when more than 0.2% of its pixels differ
(`maxDiffPixelRatio: 0.002`). Baselines live in `visual/__screenshots__/<story id>/<theme>-<width>.png`.

Baselines are Linux Chromium renders from the pinned image
`mcr.microsoft.com/playwright:v1.60.0-noble` (same version as the `playwright` catalog entry). They
are **never generated on a developer machine**: fonts and anti-aliasing differ by OS. CI runs the
`visual` job of `.github/workflows/storybook.yml` in that image; on failure it uploads the
`visual-diffs` artifact with the expected, actual and diff PNG of every failing story (plus the
HTML report). Download it from the workflow run to see what changed.

To update baselines after an intended visual change:

1. Push the change and open the PR (branch in this repository).
2. Add the `visual:update` label. `.github/workflows/visual-update.yml` builds Storybook in the
   pinned image, runs `test:visual:update`, commits `test(ui): update visual baselines` to the
   branch, re-runs the Storybook workflow on it and removes the label. On a branch without a PR,
   dispatch the **Visual update** workflow on that branch instead.
3. Pull the commit and review the changed PNGs in the PR diff like any other change.

To reproduce locally without touching your machine's browsers, run the same image:
`docker run --rm -v "$PWD:/repo" -w /repo mcr.microsoft.com/playwright:v1.60.0-noble bash -c
'corepack enable && pnpm install --frozen-lockfile && pnpm --filter @causedeck/ui build-storybook
&& pnpm --filter @causedeck/ui test:visual'`. Prefer the label for committing baselines.

A story whose output cannot be made deterministic (live data, real time) opts out with
`tags: ['skip-visual']`; give the reason in a comment. Fix flakiness first (fixed dates, seeded
data) rather than skipping.

## Adding a component

1. Create `src/components/<name>/` with `<name>.tsx`, `<name>.stories.tsx`, `<name>.test.tsx`
   and an `index.ts` re-exporting the public API. The shadcn CLI works too (`components.json`),
   but rewrite its output to the rules below.
2. Export it from `src/index.ts` and add a subpath export to `package.json`:
   `"./<name>": "./src/components/<name>/index.ts"`. Add a budget in `scripts/check-bundle-size.ts`.
3. Write stories for the shared states: `Default`, `Hover`, `FocusVisible`, `Active`,
   `Disabled`, `Loading`, `Invalid`, `WithIcon`, `LongText`, `RtlNeutral`, `Tamil`, `Kannada`.
   If a state cannot apply, declare it in the stories file and give the reason, e.g.
   `// check-stories: n/a Loading, Invalid (static, non-interactive)`. `check:stories` enforces
   this list.
4. Add `play` functions for behaviour. Every story also runs axe in light and dark.
5. Keep copy in `src/components/__fixtures__/` with fictional names only (for example
   `M/s Kaveri Textiles v. State of Tamil Nadu`).
6. Run `pnpm --filter @causedeck/ui lint typecheck test test:storybook check:stories check:bundle`.

## Token rules

- Colours, radii, shadows, durations, easings and z-index come only from the tokens: `bg-surface`,
  `text-ink`, `border-line-control`, `rounded-md`, `shadow-2`, `duration-(--dur-fast)`,
  `ease-standard`, `z-modal`. The preset removes Tailwind's default palette and scales.
- `eslint.config.js` bans arbitrary colour values on every colour utility (`bg-[#fff]`,
  `text-[oklch(...)]`, `border-[rgb(...)]`, `fill-[color:...]` and so on), numeric z-index (`z-[5]`,
  `z-10`), and arbitrary radius, shadow, duration and easing values. Tests are exempt because they
  hold banned classes as fixtures.
- JavaScript that needs a token value (charts, motion) imports it from `tokens/tokens.ts`.
- No `any` in exported props (`@typescript-eslint/no-explicit-any` and the `no-unsafe-*` rules).

## Motion

`src/lib/motion.ts` provides `fadeUp`, `scaleIn`, `menu`, `sheet` and `listLayout`. They are built from
the token durations and easings; the list spring is `{ stiffness: 420, damping: 34 }`. Always
pass `useReducedMotion()`:

```tsx
const reduced = useReducedMotion();
<motion.div {...getMotionPreset('fadeUp', reduced)} />;
```

Under `prefers-reduced-motion: reduce` every preset collapses: no transform or opacity animation,
and state changes are instant. CSS transitions use the duration tokens, which `tokens/motion.css`
shortens to 0.01 ms. `src/lib/reduced-motion.browser.test.tsx` checks this by emulating the media
query.

## Overlays

Floating layers (popover, tooltip, hover-card, menus, dialog, sheet, drawer, command) are the only
components with shadows. They share the recipes in `src/lib/overlay.ts`: `bg-surface-overlay`, a
`--line` hairline and a shadow token (in dark the shadow tokens add the 1 px top highlight), and a
stacking token (`z-popover`, `z-modal`, `z-tooltip`, `z-overlay` for the scrim).

- Menus and popovers fade and move 4 px over 150 ms `--ease-enter` and close over 100 ms
  (`--dur-exit`) `--ease-exit`. Dialogs scale from 0.98 over 200 ms; sheets and drawers slide over
  250 ms `--ease-emphasized`; accordion and collapsible animate height over 200 ms.
- Under 768 px `DialogContent` (`layout="auto"`) becomes a bottom sheet, `DropdownMenuContent`
  becomes a bottom sheet list on touch, and `CommandDialog` fills the screen. Tabs scroll
  sideways with an edge fade when they overflow.
- `ShortcutsDialog` is the `?` shortcuts list for the app shell (#11): pass the shortcut registry;
  set `enableHotkey={false}` and control `open` if the shell binds `?` itself.
- Put `CommandEmpty` and `CommandLoading` beside `CommandList`, not inside it: a listbox may only
  contain options.

## Accessibility checklist

- Zero axe violations for every story in light and dark. `test:storybook` fails on any violation,
  so serious and critical ones can never pass.
- Keyboard: every interactive element is reachable and shows the `--ring` focus outline on
  `:focus-visible`. Never remove the outline.
- Touch: controls reach `--hit` (44 px) on coarse pointers (`pointer-coarse:hit`).
- Forced colours: transparent borders become a system-colour outline, and states do not rely on
  colour alone.
- Reduced motion: use the presets and duration tokens, never hard-coded animations.
- Loading: keep the element's box (no layout shift), set `aria-busy` and keep the accessible name.
- Text: verify Tamil and Kannada labels (taller line boxes) and `LongText` truncation.

## i18n: the `labels` convention

Components never hard-code user-facing strings. Every string a component renders or announces is
an English default passed through a `labels` prop. Callers override any subset of keys,
e.g. `<Button labels={{ loading: 'ஏற்றுகிறது' }} />`. i18n (#24) will pass translated labels.
Current defaults:

| Component / hook                     | Key       | English default | Used for                                          |
| ------------------------------------ | --------- | --------------- | ------------------------------------------------- |
| `Button`                             | `loading` | `Loading`       | Appended to the accessible name while `loading`   |
| `Spinner`                            | `loading` | `Loading`       | Accessible name of the `status` role              |
| `Kbd`, `useHotkey`, `formatHotkeyLabel` | `then` | `then`          | Joins chord steps (`G then T`)                    |
| `Dialog` (`DialogContent`)           | `close`   | `Close`         | Accessible name of the icon close button          |
| `Sheet` (`SheetContent`)             | `close`   | `Close`         | Accessible name of the icon close button          |
| `Command`                            | `label`   | `Command palette` | Accessible name of the palette (and its dialog title) |
| `CommandInput`                       | `placeholder` | `Type a command or search` | Search placeholder                    |
| `CommandEmpty`                       | `empty`   | `No results found.` | Shown when nothing matches                    |
| `CommandLoading`                     | `loading` | `Loading`       | Accessible name of the progress indicator         |
| `CommandDialog`                      | `description` | `Search for a matter or an action, then press Enter.` | Screen-reader description |
| `CommandDialog`                      | `close`   | `Close`         | Accessible name of the close button               |
| `ShortcutsDialog`                    | `title`   | `Keyboard shortcuts` | Dialog title                                 |
| `ShortcutsDialog`                    | `description` | `Shortcuts work anywhere except while you are typing in a field.` | Dialog description |
| `ShortcutsDialog`                    | `close`   | `Close`         | Accessible name of the close button               |
| `ShortcutsDialog`                    | `then`    | `then`          | Joins chord steps in the key hints                |
| `Breadcrumb`                         | `nav`     | `Breadcrumb`    | Accessible name of the nav landmark               |
| `Breadcrumb`, `BreadcrumbEllipsis`   | `more`    | `More pages`    | Screen-reader text for collapsed levels           |
| `Pagination`                         | `nav`     | `Pagination`    | Accessible name of the nav landmark               |
| `PaginationPrevious`                 | `previous` | `Previous`     | Visible link text                                 |
| `PaginationNext`                     | `next`    | `Next`          | Visible link text                                 |
| `PaginationPrevious`                 | `goToPrevious` | `Go to previous page` | Accessible name of the previous link     |
| `PaginationNext`                     | `goToNext` | `Go to next page` | Accessible name of the next link             |
| `PaginationEllipsis`                 | `more`    | `More pages`    | Screen-reader text for skipped pages              |
| `DataTable`                          | `loading` | `Loading`       | Announced while skeleton rows show                |
| `DataTable`                          | `empty`   | `Nothing here yet.` | Default empty state when no `empty` slot is given |
| `DataTable`                          | `errorTitle` | `Could not load this list.` | Error alert title                                 |
| `DataTable`                          | `errorDescription` | `Check your connection, then try again.` | Error alert text                                  |
| `DataTable`                          | `retry`   | `Try again`     | Error alert retry button                          |
| `DataTable`                          | `offline` | `You are offline. Showing saved data.` | Offline banner                                    |
| `DataTable`                          | `denied`  | `You do not have access to this. Ask the workspace owner.` | Permission-denied message                         |
| `DataTable`                          | `selectAll` | `Select all rows` | Header checkbox name                              |
| `DataTable`                          | `selectRow` | `Select row`    | Row checkbox name (`: <getRowLabel>` appended)    |
| `DataTable`                          | `columns` | `Columns`       | Column visibility menu button and heading         |
| `DataTable`                          | `density` | `Row density`   | Accessible name of the density toggle             |
| `DataTable`                          | `comfortable` | `Comfortable`   | Density option (44 px rows)                       |
| `DataTable`                          | `compact` | `Compact`       | Density option (32 px rows)                       |
| `Calendar`, `DatePicker`             | `previousMonth` | `Previous month` | Previous-month button name                        |
| `Calendar`, `DatePicker`             | `nextMonth` | `Next month`    | Next-month button name                            |
| `Calendar`, `DatePicker`             | `holiday` | `Court holiday` | Appended to a holiday's day name                  |
| `DatePicker`                         | `placeholder` | `dd/mm/yyyy`    | Input placeholder (the typed format)              |
| `DatePicker`                         | `openCalendar` | `Choose date`   | Calendar button name                              |
| `DatePicker`                         | `calendar` | `Calendar`      | Accessible name of the calendar popover           |
| `DatePicker`                         | `invalid` | `Enter a date as dd/mm/yyyy, for example 12/03/2026.` | Shown when typed text is not a date               |

Key symbols (⌘, ⇧, Ctrl, Esc) are not translated. Calendar month and weekday names come from
the `locale` prop (en-IN by default). Tabs, accordion, collapsible, popover,
tooltip, hover-card, the menus, alert-dialog and drawer render no built-in strings: all their copy
comes from children.

## Hooks

- `useMediaQuery(query)`: SSR-safe, and `false` until hydrated.
- `useReducedMotion()`: `prefers-reduced-motion: reduce`.
- `useHotkey(hotkey, handler, options)`: supports `mod+k` (⌘ on Apple, Ctrl elsewhere) and chords
  like `g then t` within 1 s. Plain-key hotkeys are ignored while typing in inputs, textareas,
  selects and contenteditable; modifier hotkeys still fire. Returns the platform-aware label.
