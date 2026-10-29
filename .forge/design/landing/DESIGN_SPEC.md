<!-- FORGE:DESIGN_SPEC -->
# Landing page design spec (#90)

Message: the night before court is the hard part; CauseDeck makes it quiet. Software for advocates,
not legal services. Audience: advocates and juniors in Chennai and Bengaluru on Android phones and
office laptops, reading English first.

## Direction
- Editorial: Newsreader headlines, Geist interface text, tabular numerals for items, dates and case
  numbers. OKLCH tokens from `@causedeck/ui` only: ink and paper, one indigo accent, warning amber
  for what changed overnight, success green for verified marks. Dark mode uses the designed dark
  tokens, not an inversion.
- Hero: headline and subhead left, Court-Day Board right (about 60% at 1280). Halls are columns of
  `CourtItemChip` cards, a `ProvenanceChip` sits on a quoted order line, a brief sheet peeks behind.
  At 360 px the columns become a horizontal snap strip.
- Page: hero, problem strip, the loop (Capture, Prepare, Execute, Follow up), provenance, trust,
  courts, FAQ, CTA band, footer with the positioning line.
- Motion: 150 to 250 ms; one overnight-change settle on the hero board; slow CSS scroll-driven
  parallax on the brief sheet; a soft reveal that never drops below 0.6 opacity. All removed under
  `prefers-reduced-motion`.

## Constraints
- Rule 36: product facts only; no testimonials, outcomes, listings or litigant language.
- Static export, no cookies, no forms, no client JS beyond the board preview.
- Primary CTA goes to the app sign-in (`NEXT_PUBLIC_APP_URL`), else `/contact/` (a mailto).

## Perceptual negatives (final render must pass)
Gradient blobs; courtroom clichés (gavels, scales, pillars); centred everything with identical card
grids; low-contrast grey; unreadable Tamil or Kannada; walls of text; carousels; banners; fake logos.
