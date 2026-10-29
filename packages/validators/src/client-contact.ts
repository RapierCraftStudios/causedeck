// Client contacts (#82, part 1 of 3): the zod inputs of the `@causedeck/core/people` contact
// services. A contact is a client's reachable details (phone, email, language) kept next to the
// client's `person` row; there is no prospect or lead state. Phone numbers are E.164 and are stored
// as typed after trimming; objects are strict, so an unknown key is an error.
import { z } from 'zod';

/** What a contact is for, one per client and kind (`client_contact` is unique on person and kind). */
export const CONTACT_KINDS = ['primary', 'instructing', 'accounts', 'family'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** The language a client wants to be written to in (English plus the Indian languages we localise). */
export const LANGUAGE_PREFS = ['en', 'hi', 'ta', 'kn', 'te', 'ml', 'mr'] as const;
export type LanguagePref = (typeof LANGUAGE_PREFS)[number];

/** The relations a contact can have to a matter: the client is represented, or instructs us. */
export const CONTACT_MATTER_RELATIONS = ['represents', 'instructed_by'] as const;
export type ContactMatterRelation = (typeof CONTACT_MATTER_RELATIONS)[number];

/** E.164: `+`, a non-zero country digit, at most 15 digits in all. */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

const uuid = z.uuid();
const phone = z.string().trim().regex(E164_PATTERN, 'Use E.164, e.g. +919876543210');
const email = z.email().max(320);

export const ContactKindSchema = z.enum(CONTACT_KINDS);
export const LanguagePrefSchema = z.enum(LANGUAGE_PREFS);

/** A new contact for an existing client; at least a phone or an email. */
export const ClientContactInput = z
  .strictObject({
    personId: uuid,
    kind: ContactKindSchema.default('primary'),
    phone: phone.optional(),
    email: email.optional(),
    languagePref: LanguagePrefSchema.default('en'),
    /** Link the new contact to this matter at once (a junior must give one they are assigned to). */
    matterId: uuid.optional(),
    relation: z.enum(CONTACT_MATTER_RELATIONS).default('represents'),
  })
  .refine((value) => value.phone !== undefined || value.email !== undefined, {
    path: ['phone'],
    message: 'Give a phone or an email',
  });

/** A change to a contact; `null` clears a phone or email (one of the two must remain). */
export const UpdateClientContactInput = z
  .strictObject({
    contactId: uuid,
    phone: phone.nullable().optional(),
    email: email.nullable().optional(),
    languagePref: LanguagePrefSchema.optional(),
  })
  .refine(
    (value) =>
      value.phone !== undefined || value.email !== undefined || value.languagePref !== undefined,
    { path: ['phone'], message: 'Give something to change' },
  );

export const LinkContactToMatterInput = z.strictObject({
  contactId: uuid,
  matterId: uuid,
  relation: z.enum(CONTACT_MATTER_RELATIONS).default('represents'),
});

export const ContactIdInput = z.strictObject({ contactId: uuid });

/** Archive a contact; `purge` also flags it for the DPDP erasure sweep. */
export const ArchiveClientContactInput = z.strictObject({
  contactId: uuid,
  purge: z.boolean().default(false),
});

export const ListContactsInput = z.strictObject({
  personId: uuid.optional(),
  includeArchived: z.boolean().default(false),
});

export type ClientContactInput = z.input<typeof ClientContactInput>;
export type UpdateClientContactInput = z.input<typeof UpdateClientContactInput>;
export type LinkContactToMatterInput = z.input<typeof LinkContactToMatterInput>;
export type ArchiveClientContactInput = z.input<typeof ArchiveClientContactInput>;
export type ListContactsInput = z.input<typeof ListContactsInput>;
