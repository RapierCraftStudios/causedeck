// Owner two-factor policy (#290, spike §6, PRD PL-1): a workspace owner must turn on 2FA within
// 7 days of being granted the owner role (`member.role_granted_at`, stamped by every path that
// grants a role). After the grace, the shell shows a persistent banner and the destructive
// actions (delete the workspace, export its data, manage billing) are refused until 2FA is on.
//
// `ownerTwoFactorState` is the pure decision. `guard` (lib/guard.ts) enforces it for destructive
// actions, so every `workspaceAction` and guarded route refuses them with `FORBIDDEN`; the
// workspace layout reads `loadOwnerTwoFactorState` for the banner. Ownership transfer is not
// destructive here, so an owner without 2FA can always hand the workspace on.
import type { Action } from '@causedeck/auth/policy';

import type { AppSession } from './auth.ts';
import { ActionError } from './safe-action.ts';

/** Days an owner may run without 2FA after being granted the role. */
export const OWNER_2FA_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Actions refused to an owner whose grace has run out: delete, export and billing. */
export const DESTRUCTIVE_ACTIONS = [
  'workspace.delete',
  'export.run',
  'billing.manage',
] as const satisfies readonly Action[];

/** The denial reason recorded on `access.denied` when the policy refuses an action. */
export const TWO_FACTOR_REQUIRED = 'TWO_FACTOR_REQUIRED';

/**
 * - `not-owner`: the policy does not apply.
 * - `enabled`: an owner with 2FA on.
 * - `grace`: an owner without 2FA, still inside the 7 days.
 * - `required`: an owner without 2FA after the grace; banner shown, destructive actions refused.
 */
export type OwnerTwoFactorState = 'not-owner' | 'enabled' | 'grace' | 'required';

export function isDestructive(action: Action | undefined): boolean {
  return action !== undefined && (DESTRUCTIVE_ACTIONS as readonly Action[]).includes(action);
}

/** When an owner granted the role at `roleGrantedAt` must have 2FA on. */
export function graceEndsAt(roleGrantedAt: Date): Date {
  return new Date(roleGrantedAt.getTime() + OWNER_2FA_GRACE_DAYS * DAY_MS);
}

export function ownerTwoFactorState({
  role,
  roleGrantedAt,
  twoFactorEnabled,
  now = new Date(),
}: {
  /** A `Role`, or any member role string (unknown roles are not owners). */
  role: string | null;
  roleGrantedAt: Date | null;
  twoFactorEnabled: boolean;
  now?: Date;
}): OwnerTwoFactorState {
  if (role !== 'owner') return 'not-owner';
  if (twoFactorEnabled) return 'enabled';
  // An unknown grant time cannot start a grace: treat it as already over (fail closed).
  if (roleGrantedAt === null) return 'required';
  return now.getTime() >= graceEndsAt(roleGrantedAt).getTime() ? 'required' : 'grace';
}

/** The role and when it was granted; `@causedeck/core/runtime` `ownerGraceFor` by default. */
export type OwnerGraceLookup = (
  userId: string,
  workspaceId: string,
) => Promise<{ role: string; roleGrantedAt: Date } | null>;

async function defaultOwnerGrace(
  userId: string,
  workspaceId: string,
): Promise<{ role: string; roleGrantedAt: Date } | null> {
  const { ownerGraceFor } = await import('@causedeck/core/runtime');
  return ownerGraceFor(userId, workspaceId);
}

/** `twoFactorEnabled` on the Better Auth session user (the twoFactor plugin's field). */
export function sessionTwoFactorEnabled(session: AppSession): boolean {
  return (session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;
}

/**
 * The state for the session's user in `workspaceId`. Only an owner without 2FA costs a query;
 * pass `role` when the caller already knows it to skip the lookup for everyone else.
 */
export async function ownerTwoFactorStateFor(
  session: AppSession,
  workspaceId: string,
  {
    role,
    ownerGrace = defaultOwnerGrace,
    now,
  }: { role?: string | null; ownerGrace?: OwnerGraceLookup; now?: Date } = {},
): Promise<OwnerTwoFactorState> {
  if (role !== undefined && role !== 'owner') return 'not-owner';
  if (sessionTwoFactorEnabled(session)) return role === 'owner' ? 'enabled' : 'not-owner';
  const grace = await ownerGrace(session.user.id, workspaceId);
  return ownerTwoFactorState({
    role: grace?.role ?? null,
    roleGrantedAt: grace?.roleGrantedAt ?? null,
    twoFactorEnabled: false,
    ...(now ? { now } : {}),
  });
}

/** Refuses `action` with `FORBIDDEN` when it is destructive and the owner's grace has run out. */
export async function assertOwnerTwoFactor(
  session: AppSession,
  workspaceId: string,
  options: { role?: string | null; ownerGrace?: OwnerGraceLookup; now?: Date } = {},
): Promise<void> {
  const state = await ownerTwoFactorStateFor(session, workspaceId, options);
  if (state === 'required') {
    throw new ActionError(
      'FORBIDDEN',
      'Turn on two-factor authentication to delete, export or change billing.',
    );
  }
}

/** For the shell banner: the signed-in user's state in `workspaceId`, `not-owner` when signed out. */
export async function loadOwnerTwoFactorState(
  workspaceId: string,
  role: string,
): Promise<OwnerTwoFactorState> {
  if (role !== 'owner') return 'not-owner';
  const { getSession } = await import('./auth.ts');
  const session = await getSession();
  if (!session) return 'not-owner';
  return ownerTwoFactorStateFor(session, workspaceId, { role });
}
