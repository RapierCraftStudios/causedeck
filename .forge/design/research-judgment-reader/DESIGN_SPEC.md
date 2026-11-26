<!-- FORGE:DESIGN_SPEC -->
# Judgment reader design spec (#1191)

Purpose: a member checks a cited passage without leaving CauseDeck. Every source link in Research,
the copilot and the drafting studio opens the stored judgment here at the cited page with the cited
paragraph highlighted, instead of the stored provenance URL (for bulk-imported judgments an archive
member, `….tar#member.pdf`, that no browser opens). Audience: advocates and juniors in a signed-in
workspace (`matter.read`), on Android phones and office laptops. Authenticated page, kept out of
search indexes (`robots: { index: false, follow: false }`), not in the sitemap or `llms.txt`.

## Route
- `/w/[slug]/research/judgments/[id]?page=N&para=M#cited` (`lib/judgment-href.ts`). Linked from the
  copilot source cards, authority search results, statute authorities, the matter's relevant
  judgments, and the studio's Citations panel and authority drawer. No new nav item.
- `/api/judgments/[id]/pdf`: "Download PDF", a redirect to a short-lived presigned GET of the stored
  original (`blob_key`); never the provenance URL.

## Direction
- Same frame as `/research` and the statute pages: back link "Back to research" (muted, underlined,
  `text-sm`), h1 `font-serif text-2xl font-medium`, sections stacked with `gap-6`.
- Header, in reading order:
  1. Title: the case title as stored (the masked form when `title_masked`, D-053); "Title withheld"
     when masked and empty; else the neutral citation; else "Judgment".
  2. Facts as a two-column `dl` (`text-sm`, labels muted, values in tabular numerals): Citation, Case
     numbers, Court, Decided, Bench. Empty facts are left out, never shown as blank or `null`.
  3. Actions row: `Button` secondary `sm` "Download PDF" when the original is stored and servable;
     otherwise the muted line "The original PDF is not stored." Then the muted note "Names in this
     text are anonymised."
- Pages: one bordered card per page (`rounded-md border p-3`), a muted "Page N" heading, the court's
  paragraphs in `font-serif whitespace-pre-wrap`.
- Cited paragraph: a `mark` with `bg-accent-soft text-ink rounded-md p-2` and a muted "Cited
  paragraph" label above the text; it carries `id="cited"` so the `#cited` fragment scrolls it into
  view with no client script (`scroll-mt-4`). When the paragraph is unknown or not on the cited page,
  the cited page card carries the anchor instead.
- Tokens and primitives from `@causedeck/ui` only (`buttonVariants`, `EmptyState`,
  `PermissionDenied`); no new colours, fonts or spacing.

## States
- Not available: absent judgment, not yet redacted (only `redacted_text` is served, ADR 0051 /
  D-053) or a malformed id: `EmptyState` "This judgment is not available" with "It is not in the
  corpus, or its anonymised text is not ready yet.", under the back link.
- No `matter.read`: `PermissionDenied` with the reader copy. Not a member of the workspace:
  `notFound()`.
- Loading: the workspace `RouteSkeleton`.
- No PDF, or a masked or sensitive judgment (the original carries unmasked names): no download
  button, the muted "not stored" line.

## Layout
Single column at 360, 768 and 1280. The facts grid stays two columns (labels are short); long values
and paragraphs wrap. Nothing scrolls sideways at 360.

## Perceptual negatives (final render must pass)
No iframe or embedded PDF; no link to a `.tar` or other archive URL; no unmasked party names
(`page_text` is never read); no AI summary, headnote or editorial text (D-001 amended / ADR 0051);
no raw JSON, `null` or placeholder boxes; one highlighted paragraph at most.
