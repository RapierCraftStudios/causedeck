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
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>;
export type ChangeRoleInput = z.infer<typeof ChangeRoleInput>;
