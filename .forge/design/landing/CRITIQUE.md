# Render-critique log (#90)

## Iteration 1 (code review of the composition; no browser was available in the build lane)
Rendering is a CI-only step on this host (no browsers, no `next build`). The first critique is
against the composition and tokens:
- Perceptual negatives: no gradients, no courtroom imagery, no logos, no carousel; the loop uses a
  two-column list of unequal content (index, title, body, sample line), not a uniform icon grid.
- Contrast: body text uses `text-ink` or `text-ink-muted` on `surface` or `surface-raised`; the
  captions use `text-ink-subtle` at 12 px and are the first thing to re-check on the CI render.
- Mobile: the board columns scroll horizontally with snap at 360 px; the hero stacks.
- Follow-ups for the render-critique pass on the CI screenshots (site e2e artifact): the hero
  board height at 768, caption contrast in dark mode, and the Tamil and Kannada stub fallback.
