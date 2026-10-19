// The workspace profile (#284): name and kind on `organization`, time zone, default locale and
// practice city on `workspace_settings`. Editing needs `workspace.manage` (advocate and up); a slug
// change goes through the owner-only `renameSlug`, which keeps the old slug redirecting. Both
// changes are audited in the caller's transaction: `workspace.profile_updated` with the changed
// field names only, `workspace.slug_renamed` fail-closed.
import { schema, type Database, type Transaction } from '@causedeck/db';
import {
  UpdateWorkspaceProfileInput,
  type WorkspaceProfileFields,
} from '@causedeck/validators/workspace';
import { and, eq } from 'drizzle-orm';

import { record } from '../audit/writer.ts';

import { invalid, notFound } from './errors.ts';
import { liveWorkspace, requireCan } from './members.ts';
import { renameSlug } from './slug.ts';

type Queryable = Database | Transaction;

const { organization, workspaceSettings } = schema;

export interface WorkspaceProfile {
  id: string;
  name: string;
  slug: string;
  kind: WorkspaceProfileFields['kind'];
  timezone: string;
  locale: WorkspaceProfileFields['locale'];
  practiceCity: string | null;
}

/** Profile fields an update can change, in display order (audit metadata uses these names). */
export const PROFILE_FIELDS = ['name', 'kind', 'timezone', 'locale', 'practiceCity'] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** The live workspace's profile; settings default when the workspace has no settings row yet. */
export async function getWorkspaceProfile(
  db: Queryable,
  workspaceId: string,
): Promise<WorkspaceProfile | null> {
  const [row] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      kind: organization.kind,
      timezone: workspaceSettings.timezone,
      locale: workspaceSettings.locale,
      practiceCity: workspaceSettings.practiceCity,
    })
    .from(organization)
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, organization.id))
    .where(and(eq(organization.id, workspaceId), liveWorkspace));
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind as WorkspaceProfile['kind'],
    timezone: row.timezone ?? 'Asia/Kolkata',
    locale: (row.locale ?? 'en') as WorkspaceProfile['locale'],
    practiceCity: row.practiceCity ?? null,
  };
}

export interface UpdateWorkspaceProfileRequest {
  workspaceId: string;
  actorUserId: string;
  input: UpdateWorkspaceProfileInput;
  /** Request metadata for the audit rows. */
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

export interface UpdateWorkspaceProfileResult {
  profile: WorkspaceProfile;
  /** The fields whose value changed (the slug is reported by `renamed`). */
  changed: ProfileField[];
  /** Set when the slug changed: the old slug now redirects to `profile.slug`. */
  renamed: { from: string; to: string } | null;
}

/**
 * Save the workspace profile. Requires `workspace.manage`; a different `slug` also requires
 * `workspace.rename` (owners only, via `renameSlug`). Runs in one transaction (a savepoint when
 * `db` is already one), so the profile, the rename and their audit events commit together.
 */
export async function updateWorkspaceProfile(
  db: Queryable,
  request: UpdateWorkspaceProfileRequest,
): Promise<UpdateWorkspaceProfileResult> {
  const parsed = UpdateWorkspaceProfileInput.safeParse(request.input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid profile');
  const fields = parsed.data;
  const { workspaceId, actorUserId } = request;

  return db.transaction(async (tx) => {
    await requireCan(tx, workspaceId, actorUserId, 'workspace.manage');
    const before = await getWorkspaceProfile(tx, workspaceId);
    if (!before) throw notFound();

    const changed = PROFILE_FIELDS.filter((field) => before[field] !== fields[field]);
    if (changed.includes('name') || changed.includes('kind')) {
      await tx
        .update(organization)
        .set({ name: fields.name, kind: fields.kind })
        .where(eq(organization.id, workspaceId));
    }
    if (changed.some((field) => field !== 'name' && field !== 'kind')) {
      const settings = {
        timezone: fields.timezone,
        locale: fields.locale,
        practiceCity: fields.practiceCity,
      };
      await tx
        .insert(workspaceSettings)
        .values({ workspaceId, ...settings })
        .onConflictDoUpdate({ target: workspaceSettings.workspaceId, set: settings });
    }

    const audit = {
      db: tx,
      workspaceId,
      actor: { userId: actorUserId, kind: 'user' as const },
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.userAgent === undefined ? {} : { userAgent: request.userAgent }),
      ...(request.ip === undefined ? {} : { ip: request.ip }),
    };
    if (changed.length > 0) {
      await record(audit, {
        action: 'workspace.profile_updated',
        target: { kind: 'workspace', id: workspaceId },
        metadata: { fields: changed.join(',') },
      });
    }

    let renamed: UpdateWorkspaceProfileResult['renamed'] = null;
    if (fields.slug !== undefined && fields.slug !== before.slug.toLowerCase()) {
      const to = await renameSlug(tx, { workspaceId, actorUserId, newSlug: fields.slug });
      renamed = { from: before.slug, to };
      await record(audit, {
        action: 'workspace.slug_renamed',
        target: { kind: 'workspace', id: workspaceId },
        metadata: renamed,
      });
    }

    return {
      profile: {
        id: before.id,
        name: fields.name,
        slug: renamed?.to ?? before.slug,
        kind: fields.kind,
        timezone: fields.timezone,
        locale: fields.locale,
        practiceCity: fields.practiceCity,
      },
      changed,
      renamed,
    };
  });
}
