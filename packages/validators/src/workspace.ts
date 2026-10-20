// Workspace inputs (#177, #18): forms in `apps/web` and the domain service in `@causedeck/core`
// parse with these, so both reject the same values.
import { z } from 'zod';

import { WORKSPACE_ROLE_VALUES } from './api/me';

/** Slugs that would shadow an app route (`/admin`, `/api`, `/sign-in`, ...). */
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'account',
  'invite',
  'onboarding',
  'sign-in',
  'settings',
] as const;

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 48;

export const WORKSPACE_KIND_VALUES = ['solo', 'chamber'] as const;

/** Roles an invitation may grant; ownership only moves by explicit transfer. */
export const INVITE_ROLE_VALUES = ['advocate', 'junior', 'clerk', 'viewer'] as const;

export function isReservedSlug(value: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(value.toLowerCase());
}

/** A URL-safe workspace slug: lowercase words joined by single hyphens. */
export const Slug = z
  .string()
  .min(SLUG_MIN_LENGTH)
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single hyphens')
  .refine((value) => !isReservedSlug(value), 'This slug is reserved');

export const CreateWorkspaceInput = z.object({
  name: z.string().trim().min(1, 'A workspace name is required').max(120),
  kind: z.enum(WORKSPACE_KIND_VALUES).default('solo'),
});

/** UI locales a workspace may default to; mirrors `@causedeck/i18n/locales` `LOCALES`. */
export const WORKSPACE_LOCALE_VALUES = ['en', 'ta', 'kn'] as const;

export const WORKSPACE_NAME_MAX_LENGTH = 120;
export const PRACTICE_CITY_MAX_LENGTH = 80;

/** True for an IANA time zone the runtime knows (`Asia/Kolkata`, `UTC`, ...). */
export function isTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The workspace profile (#284): name, kind, time zone, default locale and practice city, plus an
 * optional new slug (owner-only rename). An empty practice city clears it.
 */
export const UpdateWorkspaceProfileInput = z.object({
  name: z.string().trim().min(1, 'A workspace name is required').max(WORKSPACE_NAME_MAX_LENGTH),
  kind: z.enum(WORKSPACE_KIND_VALUES),
  timezone: z.string().trim().refine(isTimeZone, 'Choose a valid time zone'),
  locale: z.enum(WORKSPACE_LOCALE_VALUES),
  practiceCity: z
    .string()
    .trim()
    .max(PRACTICE_CITY_MAX_LENGTH)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value)),
  slug: Slug.optional(),
});

/**
 * The two role settings on the settings roles page (#285), both required: whether advocates may
 * invite members, and whether owners see restricted matters they are not listed on.
 */
export const UpdateRoleSettingsInput = z.strictObject({
  advocatesCanInvite: z.boolean(),
  ownersSeeRestrictedMatters: z.boolean(),
});

/** The raw audio retention windows the settings privacy page offers, in days (#286); 30 is the maximum. */
export const RETENTION_AUDIO_DAYS = [7, 14, 30] as const;

/**
 * The two editable privacy settings on the settings privacy page (#286), both required: whether new
 * sensitive matters start restricted, and how many days raw audio is kept. Strict and without an
 * India-only AI field, so no request can turn India-only AI processing off.
 */
export const UpdateWorkspacePrivacyInput = z.strictObject({
  sensitiveDefaultRestricted: z.boolean(),
  retentionAudioDays: z.literal(RETENTION_AUDIO_DAYS),
});

/**
 * The integration tokens on the settings integrations page (#287): the private email intake address
 * and the private ICS feed URL. Mirrors `INTEGRATION_KINDS` in `@causedeck/db`.
 */
export const INTEGRATION_KIND_VALUES = ['email_intake', 'ics_feed'] as const;

/** Rotate (or create) one integration token; the only input is which one. */
export const RotateIntegrationTokenInput = z.strictObject({
  kind: z.enum(INTEGRATION_KIND_VALUES),
});

export const InviteInput = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  role: z.enum(INVITE_ROLE_VALUES),
});

export const AcceptInviteInput = z.object({
  token: z.string().min(1),
});

export const ChangeRoleInput = z.object({
  memberId: z.uuid(),
  role: z.enum(WORKSPACE_ROLE_VALUES),
});

export type Slug = z.infer<typeof Slug>;
export type CreateWorkspaceInput = z.input<typeof CreateWorkspaceInput>;
export type InviteInput = z.infer<typeof InviteInput>;
export type UpdateWorkspaceProfileInput = z.input<typeof UpdateWorkspaceProfileInput>;
export type WorkspaceProfileFields = z.output<typeof UpdateWorkspaceProfileInput>;
export type UpdateRoleSettingsInput = z.infer<typeof UpdateRoleSettingsInput>;
export type UpdateWorkspacePrivacyInput = z.infer<typeof UpdateWorkspacePrivacyInput>;
export type RetentionAudioDays = (typeof RETENTION_AUDIO_DAYS)[number];
export type IntegrationKindValue = (typeof INTEGRATION_KIND_VALUES)[number];
export type RotateIntegrationTokenInput = z.infer<typeof RotateIntegrationTokenInput>;
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>;
export type ChangeRoleInput = z.infer<typeof ChangeRoleInput>;
