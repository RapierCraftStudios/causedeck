// Outward update drafts (#69, #735; ADR 0038): the zod inputs of the `@causedeck/core` outward
// service. A draft is prepared for the lawyer to edit and share from their own channel; nothing
// here describes a send. Objects are strict.
import { z } from 'zod';

const uuid = z.uuid();

/** Who a draft is for: an existing client, or senior or briefing counsel (no other third party). */
export const AUDIENCES = ['client', 'senior_counsel', 'briefing_counsel'] as const;
export const Audience = z.enum(AUDIENCES);
export type Audience = z.infer<typeof Audience>;

export const LANGUAGES = ['en', 'ta', 'kn'] as const;
export const Language = z.enum(LANGUAGES);
export type Language = z.infer<typeof Language>;

export const TONES = ['formal', 'brief', 'warm'] as const;
export const Tone = z.enum(TONES);
export type Tone = z.infer<typeof Tone>;

/** `drafted` -> `edited` (a lawyer's version exists) -> `shared` (the lawyer shared it). */
export const DRAFT_STATUSES = ['drafted', 'edited', 'shared'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** How the lawyer shared it: copy, a user-initiated link, or a download. */
export const SHARE_CHANNELS = ['clipboard', 'whatsapp_link', 'mailto', 'download'] as const;
export const ShareChannel = z.enum(SHARE_CHANNELS);
export type ShareChannel = z.infer<typeof ShareChannel>;

export const MAX_DRAFT_BODY = 20_000;

export const DraftRequest = z
  .strictObject({
    matterId: uuid,
    hearingId: uuid.optional(),
    orderId: uuid.optional(),
    audience: Audience,
    /** Defaults to English until relationship memory and preferences exist (#72, #82). */
    language: Language.optional(),
    tone: Tone.optional(),
    /** The existing client the draft is for; required for the `client` audience. */
    clientPersonId: uuid.optional(),
  })
  .refine((v) => v.hearingId !== undefined || v.orderId !== undefined, {
    message: 'A hearing or an order is required',
    path: ['hearingId'],
  })
  .refine((v) => v.audience !== 'client' || v.clientPersonId !== undefined, {
    message: 'A client draft needs the client contact',
    path: ['clientPersonId'],
  })
  .refine((v) => v.audience === 'client' || v.clientPersonId === undefined, {
    message: 'Only a client draft names a client contact',
    path: ['clientPersonId'],
  });
export type DraftRequest = z.infer<typeof DraftRequest>;

export const DraftEdit = z.strictObject({
  draftId: uuid,
  body: z.string().trim().min(1, 'Must not be blank').max(MAX_DRAFT_BODY),
});
export type DraftEdit = z.infer<typeof DraftEdit>;

/** The lawyer's explicit act of sharing; the channel says how. */
export const ShareRecord = z.strictObject({
  draftId: uuid,
  channel: ShareChannel,
});
export type ShareRecord = z.infer<typeof ShareRecord>;
