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

| Command                                       | What it does                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm --filter @causedeck/ui storybook`       | Storybook on :6006 (theme, viewport 360/768/1280 and locale en/ta/kn toolbars)   |
| `pnpm --filter @causedeck/ui build-storybook` | Static Storybook in `storybook-static/` (published by CI as an artifact)         |
| `pnpm --filter @causedeck/ui test`            | Unit tests (node and jsdom); what turbo and CI `test` run                        |
| `pnpm --filter @causedeck/ui test:storybook`  | Every story as a browser test (play + axe, light and dark), reduced-motion tests |
| `pnpm --filter @causedeck/ui check:stories`   | Fails when a component lacks its stories, test or source file                    |
| `pnpm --filter @causedeck/ui check:bundle`    | Fails when a component adds more than 6 KB gzip, or `sideEffects` changes        |
| `pnpm --filter @causedeck/ui check:contrast`  | WCAG/APCA contrast of every allowed token pair                                   |

`test:storybook` needs Playwright Chromium (`pnpm --filter @causedeck/ui exec playwright install
chromium`, once per machine; CI installs it in `.github/workflows/storybook.yml`).

The bundle check measures what a component adds on top of the shared runtime every consumer
already pays once: `cn` (clsx and tailwind-merge, about 8 KB gzip). React is external.

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

`src/lib/motion.ts` provides `fadeUp`, `scaleIn`, `sheet` and `listLayout`. They are built from
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

Key symbols (⌘, ⇧, Ctrl, Esc) are not translated.

## Hooks

- `useMediaQuery(query)`: SSR-safe, and `false` until hydrated.
- `useReducedMotion()`: `prefers-reduced-motion: reduce`.
- `useHotkey(hotkey, handler, options)`: supports `mod+k` (⌘ on Apple, Ctrl elsewhere) and chords
  like `g then t` within 1 s. Plain-key hotkeys are ignored while typing in inputs, textareas,
  selects and contenteditable; modifier hotkeys still fire. Returns the platform-aware label.
