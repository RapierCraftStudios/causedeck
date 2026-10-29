// Research notes and provider templates (#80, D-048): the input schemas the Research tab and the
// settings page share. Authority urls and provider templates are `https` only; the host rules for a
// template (no userinfo, host fixed by the template) are enforced by core `validateProviderTemplate`.
import { z } from 'zod';

export const RESEARCH_NOTE_TITLE_MAX = 200;
export const RESEARCH_NOTE_BODY_MAX = 20_000;
export const RESEARCH_AUTHORITIES_MAX = 50;
export const PROVIDER_TEMPLATE_MAX = 500;

/** An absolute `https` URL; `javascript:`, `data:` and every other scheme fail. */
export const httpsUrl = z
  .string()
  .trim()
  .max(PROVIDER_TEMPLATE_MAX)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Enter an https link');

export const researchAuthority = z.object({
  label: z.string().trim().min(1).max(300),
  citation: z.string().trim().max(300).optional(),
  url: httpsUrl.optional(),
  /** Data only: a pinned authority is a candidate for a draft, never added to one automatically. */
  pinned: z.boolean().default(false),
});
export type ResearchAuthorityInput = z.infer<typeof researchAuthority>;

export const researchNoteInput = z.object({
  title: z.string().trim().min(1).max(RESEARCH_NOTE_TITLE_MAX),
  body: z.string().max(RESEARCH_NOTE_BODY_MAX).default(''),
  authorities: z.array(researchAuthority).max(RESEARCH_AUTHORITIES_MAX).default([]),
});
export type ResearchNoteInput = z.infer<typeof researchNoteInput>;

export const providerTemplateInput = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{0,39}$/, 'Use lowercase letters, digits and hyphens'),
  label: z.string().trim().min(1).max(80),
  /** `https://host/path?q={q}`: the query is placed where `{q}` stands. */
  urlTemplate: httpsUrl.refine(
    (value) => value.includes('{q}'),
    'Include {q} where the query goes',
  ),
  enabled: z.boolean().default(true),
});
export type ProviderTemplateInput = z.infer<typeof providerTemplateInput>;
