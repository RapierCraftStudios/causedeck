// Forum catalogue schemas (#34, ADR 0014): the typed shape of a `forum` row's `language_profile` and
// `config`, and of a catalogue seed entry (`packages/db/src/seed/forum-catalogue`). Official court
// hostnames are unstable, so they are data (`config.hosts`, an ordered list: the first is preferred,
// the rest are fallbacks), never constants. Deep links are templates the lawyer opens in a new
// window; Madras HC forbids framing, so a config has no `embed` (or any other unknown) key.
import { z } from 'zod';

import { ADAPTER_LEVELS, FORUM_SIDES, JURISDICTION_KINDS } from './matter-graph';

/** The official pages a forum may link to. */
export const FORUM_DEEP_LINK_KINDS = [
  'cause_list',
  'case_status',
  'orders',
  'display_board',
  'e_copy',
  'sitting_arrangements',
  // The Advocate Information Management System (cause-list email push, case tagging; #395).
  'aims',
] as const;
export type ForumDeepLinkKind = (typeof FORUM_DEEP_LINK_KINDS)[number];

/** Catalogue and custom-forum codes, e.g. `in.tn.madras-hc.principal.appellate`. */
export const FORUM_CODE_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;

/** A bare hostname: no scheme, port, path or trailing dot. */
export const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const LANGUAGE_CODE = z.string().regex(/^[a-z]{2}$/, 'an ISO 639-1 code');

export const LanguageProfileSchema = z
  .object({
    primary: LANGUAGE_CODE.exactOptional(),
    secondary: z.array(LANGUAGE_CODE).exactOptional(),
    ocr: z.array(LANGUAGE_CODE).exactOptional(),
    stt: z.array(LANGUAGE_CODE).exactOptional(),
  })
  .strict();
export type LanguageProfile = z.infer<typeof LanguageProfileSchema>;

// A path (relative to the forum's hosts) or an absolute https URL; `{name}` placeholders only, and
// characters already percent-encoded where the official path needs it.
const TEMPLATE_PATTERN =
  /^(https:\/\/[a-z0-9.-]+\/)?([A-Za-z0-9._~!$&'()*+,;=:@/?#-]|%[0-9A-Fa-f]{2}|\{[A-Za-z_][A-Za-z0-9_]*\})*$/;

export const DeepLinkTemplateSchema = z
  .string()
  .min(1)
  .regex(TEMPLATE_PATTERN, 'a relative path or an https URL with {name} placeholders')
  .refine((t) => !t.startsWith('//'), 'a protocol-relative URL')
  .refine(
    (t) => t.startsWith('https://') || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t),
    'a URL scheme other than https',
  );
export type DeepLinkTemplate = z.infer<typeof DeepLinkTemplateSchema>;

/** The host of an absolute template, or undefined for a path relative to the forum's hosts. */
export function templateHost(template: string): string | undefined {
  return /^https:\/\/([^/]+)\//.exec(template)?.[1];
}

export const ForumConfigSchema = z
  .object({
    hosts: z.array(z.string().regex(HOSTNAME_PATTERN, 'a bare hostname')).min(1),
    deepLinks: z.partialRecord(z.enum(FORUM_DEEP_LINK_KINDS), DeepLinkTemplateSchema),
    disabledReason: z.string().min(1).exactOptional(),
    // Official pages that sit behind a captcha the lawyer solves on the court's site (#397); the
    // product never solves or fetches them, it only warns before opening the link.
    captchaGated: z.array(z.enum(FORUM_DEEP_LINK_KINDS)).exactOptional(),
    notes: z.string().min(1).exactOptional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    for (const [kind, template] of Object.entries(config.deepLinks)) {
      const host = templateHost(template);
      if (host !== undefined && !config.hosts.includes(host)) {
        ctx.addIssue({
          code: 'custom',
          path: ['deepLinks', kind],
          message: `host ${host} is not in config.hosts`,
        });
      }
    }
    for (const [index, kind] of (config.captchaGated ?? []).entries()) {
      if (config.deepLinks[kind] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['captchaGated', index],
          message: `captcha-gated ${kind} has no deep-link template`,
        });
      }
    }
  });
export type ForumConfig = z.infer<typeof ForumConfigSchema>;

export const ForumSeedSchema = z
  .object({
    code: z.string().regex(FORUM_CODE_PATTERN),
    court: z.string().min(1),
    establishment: z.string().min(1),
    seat: z.string().min(1),
    side: z.enum(FORUM_SIDES),
    jurisdictionKind: z.enum(JURISDICTION_KINDS),
    languageProfile: LanguageProfileSchema,
    adapterId: z.string().regex(FORUM_CODE_PATTERN).exactOptional(),
    // The catalogue ships at A0 or A1; the adapter issues raise a level when they ship.
    adapterLevel: z.enum(ADAPTER_LEVELS).extract(['A0', 'A1']),
    enabled: z.boolean(),
    config: ForumConfigSchema,
  })
  .strict()
  .refine((s) => s.enabled || s.config.disabledReason !== undefined, {
    path: ['config', 'disabledReason'],
    message: 'a disabled forum needs config.disabledReason',
  });
export type ForumSeed = z.infer<typeof ForumSeedSchema>;
