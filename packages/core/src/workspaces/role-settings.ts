// Role settings (#285): whether advocates may invite members (`advocates_can_invite`) and whether
// owners see restricted matters they are not listed on (`owners_see_restricted`), both on
// `workspace_settings` and both on by default. `can()` takes them as `PolicySettings`; the services
// that decide `member.invite` and restricted-matter reads load them with `getRoleSettings`. Only
// owners change them (`member.role`), audited fail-closed as `workspace.role_settings_updated` in the
// caller's transaction.
import type { PolicySettings } from '@causedeck/auth/policy';
import { schema, type Database, type Transaction } from '@causedeck/db';
import { UpdateRoleSettingsInput } from '@causedeck/validators/workspace';
import { eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';

import { invalid } from './errors.ts';
import { requireCan } from './members.ts';

type Queryable = Database | Transaction;

const { workspaceSettings } = schema;

export interface RoleSettings {
  advocatesCanInvite: boolean;
  ownersSeeRestrictedMatters: boolean;
}

/** Role settings in display order (audit metadata uses these names). */
export const ROLE_SETTING_FIELDS = ['advocatesCanInvite', 'ownersSeeRestrictedMatters'] as const;

export type RoleSettingField = (typeof ROLE_SETTING_FIELDS)[number];

export const DEFAULT_ROLE_SETTINGS: Readonly<RoleSettings> = Object.freeze({
  advocatesCanInvite: true,
  ownersSeeRestrictedMatters: true,
});

/** The workspace's role settings; the defaults when it has no settings row (or is not visible). */
export async function getRoleSettings(db: Queryable, workspaceId: string): Promise<RoleSettings> {
  const [row] = await db
    .select({
      advocatesCanInvite: workspaceSettings.advocatesCanInvite,
      ownersSeeRestricted: workspaceSettings.ownersSeeRestricted,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  if (!row) return { ...DEFAULT_ROLE_SETTINGS };
  return {
    advocatesCanInvite: row.advocatesCanInvite,
    ownersSeeRestrictedMatters: row.ownersSeeRestricted,
  };
}

/** The role settings as the `PolicySettings` that `can()` reads. */
export function toPolicySettings(settings: RoleSettings): PolicySettings {
  return {
    advocatesCanInvite: settings.advocatesCanInvite,
    ownersSeeRestrictedMatters: settings.ownersSeeRestrictedMatters,
  };
}

export interface UpdateRoleSettingsRequest {
  workspaceId: string;
  actorUserId: string;
  input: UpdateRoleSettingsInput;
  /** Request metadata for the audit row. */
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

export interface UpdateRoleSettingsResult {
  settings: RoleSettings;
  /** The settings whose value changed. */
  changed: RoleSettingField[];
}

/**
 * Save the role settings. Owners only (`member.role`); runs in one transaction (a savepoint when
 * `db` is already one), so the change and its audit event commit together. Saving the current
 * values changes nothing and records nothing.
 */
export async function updateRoleSettings(
  db: Queryable,
  request: UpdateRoleSettingsRequest,
): Promise<UpdateRoleSettingsResult> {
  const parsed = UpdateRoleSettingsInput.safeParse(request.input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid role settings');
  const next = parsed.data;
  const { workspaceId, actorUserId } = request;

  return db.transaction(async (tx) => {
    await requireCan(tx, workspaceId, actorUserId, 'member.role');
    const before = await getRoleSettings(tx, workspaceId);
    const changed = ROLE_SETTING_FIELDS.filter((field) => before[field] !== next[field]);
    if (changed.length === 0) return { settings: before, changed };

    const values = {
      advocatesCanInvite: next.advocatesCanInvite,
      ownersSeeRestricted: next.ownersSeeRestrictedMatters,
    };
    await tx
      .insert(workspaceSettings)
      .values({ workspaceId, ...values })
      .onConflictDoUpdate({ target: workspaceSettings.workspaceId, set: values });

    await record(
      {
        db: tx,
        workspaceId,
        actor: { userId: actorUserId, kind: 'user' as const },
        ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
        ...(request.userAgent === undefined ? {} : { userAgent: request.userAgent }),
        ...(request.ip === undefined ? {} : { ip: request.ip }),
      },
      {
        action: 'workspace.role_settings_updated',
        target: { kind: 'workspace', id: workspaceId },
        metadata: {
          fields: changed.join(','),
          ...Object.fromEntries(changed.map((field) => [field, String(next[field])])),
        },
      },
    );
    return { settings: { ...next }, changed };
  });
}
