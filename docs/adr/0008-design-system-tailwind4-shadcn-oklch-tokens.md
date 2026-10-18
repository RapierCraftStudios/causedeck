# 0008. Design system on Tailwind CSS v4, shadcn/ui and OKLCH tokens

## Status

Accepted

## Date

2026-10-18

## Context

The product must be calm, precise and editorial-grade, with first-class light and dark themes, WCAG AA contrast, Tamil and Kannada typography, and a 360 px Android phone as the first target. Many agents build UI in parallel, so components and tokens must be shared and documented. The spike fixes this in [§1](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (UI row) and [§7](../engineering/13-technical-architecture-spike.md#7-design-system-and-ui-direction-insanely-beautiful-is-a-requirement-not-a-hope), and in D-039.

## Decision drivers

- Full ownership of component code and visual identity (no generic look).
- Accessible primitives (focus, keyboard, ARIA) without writing them ourselves.
- Perceptually even colour roles across light and dark themes.
- Small client bundles (initial JS ≤ 180 KB gzip on the court-day route, spike §10).

## Considered options

| Option                                         | Verdict  | Reason                                                                                     |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Tailwind v4 + shadcn/ui (Radix) + OKLCH tokens | Chosen   | Components are copied into `packages/ui` and owned; Radix accessibility; zero-runtime CSS  |
| MUI                                            | Rejected | Strong Material identity that is hard to override; CSS-in-JS runtime cost and RSC friction |
| Chakra UI                                      | Rejected | Runtime styling and RSC friction; theme tokens are less suited to OKLCH roles              |
| Plain CSS modules                              | Rejected | Every accessible primitive and token utility would be hand-built and maintained by us      |

## Decision

- **Tailwind CSS v4**, **shadcn/ui** components (Radix primitives) in registry style in `packages/ui`, `lucide-react` icons and `motion` for animation, with `next-themes`, Sonner, cmdk, TanStack Table, shadcn charts (Recharts) and react-hook-form + zod.
- **Tokens** in `packages/ui/tokens`: semantic colour roles (surface, elevated, ink, muted, accent, success, warning, danger, info) in **OKLCH**, a 4 px spacing scale, radius, elevation, motion durations and easings, and z-index. Light and dark themes both meet WCAG AA (AAA for body text where feasible).
- Typography: Geist or Inter for UI, an editorial serif for headings and briefs, Noto Sans Tamil and Kannada, and tabular numerals for items, dates and ₹ amounts.
- Quality gates: a Storybook story for every component, Playwright visual baselines (light and dark, 3 viewports), zero serious axe violations, and Lighthouse ≥ 95 on key pages. Hero surfaces go through the `/design` pipeline.

## Consequences

- Positive: we own the code and the look. Accessible defaults. Small CSS with no runtime.
- Negative: shadcn components do not update upstream automatically, so we maintain the copies.
- Negative: OKLCH needs fallbacks only for very old browsers, which we accept.

## Revisit when

- Lighthouse or the bundle budget (spike §10) cannot be met because of the component layer.
- Radix or shadcn/ui stop being maintained, or Tailwind makes a breaking major change to the token model.

## Links

- [Spike §7](../engineering/13-technical-architecture-spike.md#7-design-system-and-ui-direction-insanely-beautiful-is-a-requirement-not-a-hope)
- [DECISIONS.md](../../DECISIONS.md) D-039
