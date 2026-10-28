// Client status links (#88, ADR 0049): the zod inputs of the `@causedeck/core` status-links service.
// A link carries only what the advocate authored: a headline, a short note and, if they choose, the
// next date. Objects are strict; nothing here describes a send.
import { z } from 'zod';

const uuid = z.uuid();

export const STATUS_LINK_LANGUAGES = ['en', 'ta', 'kn'] as const;
export const StatusLinkLanguage = z.enum(STATUS_LINK_LANGUAGES);
export type StatusLinkLanguage = z.infer<typeof StatusLinkLanguage>;

export const STATUS_LINK_DEFAULT_EXPIRY_DAYS = 7;
export const STATUS_LINK_MAX_EXPIRY_DAYS = 30;
export const MAX_STATUS_HEADLINE = 140;
export const MAX_STATUS_NOTE = 1_000;

const expiryDays = z.number().int().min(1).max(STATUS_LINK_MAX_EXPIRY_DAYS);

export const StatusLinkInput = z.strictObject({
  matterId: uuid,
  /** The existing client contact (#82) the link is for. */
  clientContactId: uuid,
  headline: z.string().trim().min(1).max(MAX_STATUS_HEADLINE),
  note: z.string().trim().min(1).max(MAX_STATUS_NOTE),
  /** Shown only when the advocate includes it (ISO date). */
  nextDate: z.iso.date().optional(),
  language: StatusLinkLanguage.default('en'),
  expiryDays: expiryDays.default(STATUS_LINK_DEFAULT_EXPIRY_DAYS),
});
export type StatusLinkInput = z.input<typeof StatusLinkInput>;
export type ParsedStatusLinkInput = z.output<typeof StatusLinkInput>;

export const StatusLinkExtend = z.strictObject({
  linkId: uuid,
  /** Days from creation; at most 30 in total. */
  expiryDays,
});
export type StatusLinkExtend = z.infer<typeof StatusLinkExtend>;

/** What the public page may render: the authored fields and the advocate's name, nothing else. */
export const StatusLinkView = z.strictObject({
  headline: z.string(),
  note: z.string(),
  nextDate: z.string().nullable(),
  language: StatusLinkLanguage,
  advocateName: z.string().nullable(),
  expiresAt: z.string(),
});
export type StatusLinkView = z.infer<typeof StatusLinkView>;

/** The authored fields as stored in `status_link.payload`. */
export const StatusLinkPayload = z.strictObject({
  headline: z.string(),
  note: z.string(),
  nextDate: z.string().nullable(),
});
export type StatusLinkPayload = z.infer<typeof StatusLinkPayload>;
