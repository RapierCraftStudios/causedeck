// The surfaces that carry a contextual `?` tip (#94) and the article each one opens. Kept apart
// from the article index so a page can name its article without loading the bundled sources.
export const HELP_SURFACES = [
  'today',
  'inbox',
  'obligations',
  'briefs',
  'memory',
  'general',
] as const;
export type HelpSurface = (typeof HELP_SURFACES)[number];

const SURFACE_ARTICLE: Record<HelpSurface, string> = {
  today: 'first-court-day-view',
  inbox: 'capture-inbox',
  obligations: 'obligations',
  briefs: 'briefs',
  memory: 'memory-review',
  general: 'keyboard-shortcuts',
};

export function articleSlugForSurface(surface: HelpSurface): string {
  return SURFACE_ARTICLE[surface];
}
