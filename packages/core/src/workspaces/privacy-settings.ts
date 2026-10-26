// Privacy settings (#286): India-only AI processing (`india_only_ai`, always on: nothing here or
// anywhere else in the app writes it), whether new sensitive matters start restricted
// (`sensitive_default_restricted`, on by default) and how many days raw audio is kept
// (`retention_audio_days`: 7, 14 or 30, default 30), all on `workspace_settings`. Members with
// `workspace.manage` change the last two, audited fail-closed as `workspace.privacy_updated` in the
// caller's transaction.
import { schema, type Database, type Transaction } from '@causedeck/db';
import {
  UpdateWorkspacePrivacyInput,
  type RetentionAudioDays,
} from '@causedeck/validators/workspace';
import { eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';

import { invalid } from './errors.ts';
import { requireCan } from './members.ts';

type Queryable = Database | Transaction;

const { workspaceSettings } = schema;

export interface PrivacySettings {
  /** Always true: there is no app path that turns it off. */
  indiaOnlyAi: boolean;
  sensitiveDefaultRestricted: boolean;
  retentionAudioDays: RetentionAudioDays;
  /** Share public court documents (cause lists, published orders) with every workspace (#485). */
  contributePublicCourtDocuments: boolean;
}

/** The privacy settings a member can change, in display order (audit metadata uses these names). */
export const PRIVACY_SETTING_FIELDS = [
  'sensitiveDefaultRestricted',
  'retentionAudioDays',
  'contributePublicCourtDocuments',
] as const;

export type PrivacySettingField = (typeof PRIVACY_SETTING_FIELDS)[number];

export const DEFAULT_PRIVACY_SETTINGS: Readonly<PrivacySettings> = Object.freeze({
  indiaOnlyAi: true,
  sensitiveDefaultRestricted: true,
  retentionAudioDays: 30,
  contributePublicCourtDocuments: false,
});

/** The workspace's privacy settings; the defaults when it has no settings row (or is not visible). */
export async function getPrivacySettings(
  db: Queryable,
  workspaceId: string,
): Promise<PrivacySettings> {
  const [row] = await db
    .select({
      indiaOnlyAi: workspaceSettings.indiaOnlyAi,
      sensitiveDefaultRestricted: workspaceSettings.sensitiveDefaultRestricted,
      contributePublicCourtDocuments: workspaceSettings.contributePublicCourtDocuments,
      retentionAudioDays: workspaceSettings.retentionAudioDays,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  if (!row) return { ...DEFAULT_PRIVACY_SETTINGS };
  return {
    indiaOnlyAi: row.indiaOnlyAi,
    sensitiveDefaultRestricted: row.sensitiveDefaultRestricted,
    contributePublicCourtDocuments: row.contributePublicCourtDocuments,
    // The column's check constraint allows only the offered windows.
    retentionAudioDays: row.retentionAudioDays as RetentionAudioDays,
  };
}

export interface UpdateWorkspacePrivacyRequest {
  workspaceId: string;
  actorUserId: string;
  input: UpdateWorkspacePrivacyInput;
  /** Request metadata for the audit row. */
  requestId?: string;
  userAgent?: string;
  ip?: string;
}

export interface UpdateWorkspacePrivacyResult {
  settings: PrivacySettings;
  /** The settings whose value changed. */
  changed: PrivacySettingField[];
}

/**
 * Save the sensitive-matter default, the raw audio retention window and the court document
 * contribution opt-in (#485). Needs `workspace.manage`;
 * runs in one transaction (a savepoint when `db` is already one), so the change and its audit event
 * commit together. India-only AI is not an input and is never written. Saving the current values
 * changes nothing and records nothing.
 */
export async function updateWorkspacePrivacy(
  db: Queryable,
  request: UpdateWorkspacePrivacyRequest,
): Promise<UpdateWorkspacePrivacyResult> {
  const parsed = UpdateWorkspacePrivacyInput.safeParse(request.input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid privacy settings');
  const next = parsed.data;
  const { workspaceId, actorUserId } = request;

  return db.transaction(async (tx) => {
    await requireCan(tx, workspaceId, actorUserId, 'workspace.manage');
    const before = await getPrivacySettings(tx, workspaceId);
    const wanted: Omit<PrivacySettings, 'indiaOnlyAi'> = {
      sensitiveDefaultRestricted: next.sensitiveDefaultRestricted,
      retentionAudioDays: next.retentionAudioDays,
      contributePublicCourtDocuments:
        next.contributePublicCourtDocuments ?? before.contributePublicCourtDocuments,
    };
    const changed = PRIVACY_SETTING_FIELDS.filter((field) => before[field] !== wanted[field]);
    if (changed.length === 0) return { settings: before, changed };

    const values = wanted;
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
        action: 'workspace.privacy_updated',
        target: { kind: 'workspace', id: workspaceId },
        metadata: {
          fields: changed.join(','),
          ...Object.fromEntries(changed.map((field) => [field, String(wanted[field])])),
        },
      },
    );
    return { settings: { ...before, ...values }, changed };
  });
}
