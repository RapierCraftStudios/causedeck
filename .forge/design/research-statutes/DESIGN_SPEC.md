<!-- FORGE:DESIGN_SPEC -->
# Statutes pages design spec (#1126)

Purpose: a member reads what a section says, how it changed, its counterpart in the other criminal
code and the judgments that apply it, without leaving the workspace. Audience: advocates and juniors
in a signed-in workspace (`matter.read`), on Android phones and office laptops. Authenticated pages,
kept out of search indexes (`robots: { index: false, follow: false }`).

## Routes
- `/w/[slug]/research/statutes`: search sections by number or heading.
- `/w/[slug]/research/statutes/[act]/[section]`: one section. `[act]` is a short name (`bnss`) or the
  statute key; `/research` links here ("Look up a statute section"), no new nav item.

## Direction
- Same frame as `/research`: back link (muted, underlined, `text-sm`), h1 `font-serif text-2xl
  font-medium`, one-line intro in `text-muted-foreground text-sm`, sections stacked with `gap-6`.
- Search page: one labelled input and the `Button` primary action (Search) in a GET form; results are
  `rounded-md border p-3 text-sm` rows (act short name and section as the link, heading below in
  muted text), the same card as the authority results.
- Section page, in reading order:
  1. Text: a bordered card. Directly above the text, the label for that text: "Synthetic paraphrase,
     not the bare-act wording" or "Public-domain bare act text", then the row's source note. Then
     "In force from <date>", or for a repealed section "Not in force since <date>" with the last text.
     Text in `whitespace-pre-wrap`.
  2. History: an ordered timeline, `border-l-2 pl-2` entries, date range in tabular numerals,
     "Amended by" when recorded.
  3. Counterpart in the other code: link(s) to the counterpart section page, or "No counterpart
     recorded." (never a guess; `CODE_MAP` through the statutes service).
  4. Top authorities: cards with the masked title ("Title withheld" when empty), citation · court ·
     level · decided date · p. N, and "Open court PDF at p. N" opening `sourceUrl#page=N` in a new
     window (`rel="noreferrer noopener"`).
- Tokens and primitives from `@causedeck/ui` only (`Button`, `ErrorState`, `PermissionDenied`); no
  new colours, fonts or spacing.

## States
- Search: prompt before any query; "No section matches…" for no hits; `ErrorState` on failure.
- Section: `notFound()` when the act or section is not stored; `ErrorState` on failure; "No text is
  stored", "No version is stored" and "No judgment in the corpus cites this section yet." as plain
  muted lines; route loading uses the workspace `RouteSkeleton`.
- No `matter.read`: `PermissionDenied` with the statutes copy.

## Layout
Single column at 360, 768 and 1280; the search input and button stack below `sm` and sit in a row
above it. Nothing scrolls sideways at 360; long headings wrap.

## Perceptual negatives (final render must pass)
No iframe or embedded PDF; no AI summary or suggested answer; no editorial headnote, commentary or
reporter text (D-001 amended / ADR 0051); no unmasked party names (D-053); no raw JSON, `null` or
placeholder boxes; no low-contrast grey on the label.
