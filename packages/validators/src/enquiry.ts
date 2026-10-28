// The inbound enquiry log (#87, part 1; ADR 0047): the zod inputs of the `@causedeck/core/intake`
// services. An enquiry is a person asking the chamber to take work; it is logged, checked for a
// conflict of interest and then accepted as a matter (only through the automation engine), declined,
// referred or closed. Nothing here sends anything: there is no reply, template or auto-response.
// Objects are strict, so an unknown key is an error.
import { z } from 'zod';

/** The lifecycle of an enquiry (mirrors the `enquiry_status_chk` CHECK). */
export const ENQUIRY_STATUSES = [
  'logged',
  'checked',
  'accepted_as_matter',
  'declined',
  'referred',
  'closed',
] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** How the enquiry reached the chamber (mirrors the `enquiry_channel_chk` CHECK). */
export const ENQUIRY_CHANNELS = ['phone', 'email', 'walk_in', 'referral', 'web', 'other'] as const;
export type EnquiryChannel = (typeof ENQUIRY_CHANNELS)[number];

/** Which side of the prospective matter a party is on (mirrors the `enquiry_party_side_chk` CHECK). */
export const ENQUIRY_PARTY_SIDES = ['client', 'adverse'] as const;
export type EnquiryPartySide = (typeof ENQUIRY_PARTY_SIDES)[number];

/** Statuses an advocate may set by hand with `updateEnquiry`; the others have their own service. */
export const ENQUIRY_MANUAL_STATUSES = ['declined', 'referred'] as const;

export const ENQUIRY_MAX_PARTIES = 20;
export const ENQUIRY_RETENTION_MONTHS_DEFAULT = 12;
export const ENQUIRY_RETENTION_MONTHS_MIN = 1;
export const ENQUIRY_RETENTION_MONTHS_MAX = 120;

const uuid = z.uuid();
const name = z.string().trim().min(1).max(300);
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use E.164, e.g. +919876543210');

export const EnquiryPartyInput = z.strictObject({
  name,
  side: z.enum(ENQUIRY_PARTY_SIDES),
});

export const LogEnquiryInput = z.strictObject({
  enquirerName: name,
  channel: z.enum(ENQUIRY_CHANNELS).default('other'),
  phone: phone.optional(),
  email: z.email().max(320).optional(),
  summary: z.string().trim().min(1).max(4000),
  practiceArea: z.string().trim().min(1).max(120).optional(),
  receivedAt: z.coerce.date().optional(),
  parties: z.array(EnquiryPartyInput).max(ENQUIRY_MAX_PARTIES).default([]),
});

export const UpdateEnquiryInput = z.strictObject({
  enquiryId: uuid,
  enquirerName: name.optional(),
  channel: z.enum(ENQUIRY_CHANNELS).optional(),
  phone: phone.nullable().optional(),
  email: z.email().max(320).nullable().optional(),
  summary: z.string().trim().min(1).max(4000).optional(),
  practiceArea: z.string().trim().min(1).max(120).nullable().optional(),
  /** Replaces the parties; a changed set needs a new conflict check. */
  parties: z.array(EnquiryPartyInput).max(ENQUIRY_MAX_PARTIES).optional(),
  status: z.enum(ENQUIRY_MANUAL_STATUSES).optional(),
});

export const CloseEnquiryInput = z.strictObject({
  enquiryId: uuid,
  reason: z.string().trim().min(1).max(500).optional(),
});

export const EnquiryIdInput = z.strictObject({ enquiryId: uuid });

export const AcceptEnquiryInput = z.strictObject({
  enquiryId: uuid,
  /** The matter title; the enquiry summary is used when omitted. */
  title: z.string().trim().min(1).max(300).optional(),
});

export const EnquiryRetentionMonthsSchema = z
  .number()
  .int()
  .min(ENQUIRY_RETENTION_MONTHS_MIN)
  .max(ENQUIRY_RETENTION_MONTHS_MAX);
