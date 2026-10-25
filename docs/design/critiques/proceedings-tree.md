# Design critique: the matter Proceedings tree (#392)

The #40 spec asks for a design critique of the proceedings tree before it ships (#392, R5).

**How it was run.** An independent reviewer read the tree. It was a separate agent with no part in writing the code, working read-only. It read:
- the design language (`docs/design/design-language.md`) and the #40 / #392 specs;
- the tree components (`apps/web/components/matters/proceeding-tree.tsx`, `proceeding-row.tsx`, `state-transition-menu.tsx`);
- the route (`apps/web/app/(app)/w/[slug]/matters/[id]/proceedings/{page,loading}.tsx`) and its copy;
- the Overview, for comparison.

The review is from code only; no screenshot pass was made. Visual baselines at 360/768/1280 are part of #394. The ForgeDock `/design` pipeline is reserved for hero surfaces (ADR 0008) and was not available to this lane. The critique below followed the same brief: hierarchy, density at 360 px, touch targets, focus, colour-not-alone, copy tone, motion and states.

## Findings and resolution

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | must-fix | Children could be collapsed only with the arrow keys; mouse and touch users had no control. | A visible chevron toggle (`data-toggle-children`, "Show/Hide the proceedings filed in …"). Rows without children keep an aligned spacer. No height animation, so the change is instant, as reduced motion asks. |
| 2 | must-fix | Every non-disposed state badge was accent, competing with the next date and the primary action. | The state badge is neutral. Only `defects` and `re-presented` use warning, and the word is always shown. The AC keeps the state visible on every row, including `numbered`. |
| 3 | must-fix | "Unnumbered" was said three times: in the title "(unnumbered)", the badge, and the SR/FR state. | An unnumbered row's title is its case type alone, muted. The warning `Unnumbered` badge is the single marker. |
| 4 | should-fix | The focus ring wrapped the whole subtree. `aria-selected` announced "selected" on whichever row had roving focus. | The ring is drawn on the row itself (`[&:focus-visible>[data-proceeding-row]]`). `aria-selected` is set only in split mode. |
| 5 | should-fix | The next date, the most useful fact, sat last and looked like metadata. | It moved under the forum, in medium weight. "No next date" is muted. Accent stays with the Overview's next-date card. |
| 6 | should-fix | Links to other matters were marked clickable by colour alone, and their touch targets were small. Unlinkable links looked like status badges. | Links are underlined at rest, with `pointer-coarse:min-h-11`. Unlinkable links are plain muted text. |
| 7 | should-fix | An empty tree had two identical primary `Add proceeding` buttons. Merge and Split were heavy for rare actions. | On an empty tree only the empty state carries `Add proceeding`. Merge and Split are ghost buttons. "Merge a matter into this one" replaces "Merge another matter in". |
| 8 | should-fix | At 360 px the action column squeezed the content to about 200 px. The state-menu trigger repeated the state next to its badge. | Below md the content takes the row width and the actions wrap under it. The trigger is icon-only, named "Change state of …". |
| 9 | should-fix | Split mode had weak affordance: no selected state, no count, row actions still live, and the hint scrolled away. | Selected rows get `bg-accent-soft`. "Continue with N proceedings" shows the count. Row actions are hidden while selecting. The toolbar is sticky. `Esc` leaves split mode. |
| 10 | should-fix | The loading skeleton did not match the final layout: wrong indent, no child-group rail, no action column, no second badge. | Rows have a toggle, two badges and an action column, and the child row sits in the group rail (`ms-4 border-s ps-3`). The toolbar skeleton stays, because the loading file cannot read the role. |

**Nits taken.** The tab heading matches the Overview card headings (`text-ink-muted text-sm font-medium`).

**Nit left.** Each treeitem is named by its short label (`aria-label`), and the row text gives the detail. Moving to `aria-describedby` is left for the #394 axe pass.

**Already right, kept as is.**
- State is always a word.
- Only semantic tokens are used, so dark mode needs no extra work.
- The roving tabindex covers each row's own controls.
- Buttons reach 44 px on coarse pointers.
- The skeleton fades in only under `motion-safe`.
- The CNR uses `font-mono`, `select-all` and `tabular-nums`.

Tests that hold the fixes: `apps/web/__tests__/proceedings-components.test.tsx` (toggle, split mode, the single empty-state Add) and `apps/web/__tests__/proceedings-page.test.tsx` (unnumbered title, neutral state tone, no `aria-selected` outside split mode).
