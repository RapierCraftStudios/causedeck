// Server side of the flags page (#311): installs the real flag audit writer, builds the rows the
// page shows (registry, kill switch, global row, one workspace's override, effective value) after a
// fail-closed `staff.read` audit event, and re-verifies a TOTP code for legal-gated changes.
// Reads and writes go through `@causedeck/flags`; nothing here touches `@causedeck/db` directly.
import { killSwitch } from '@causedeck/config/env';
import { flagChangeAuditSink, record } from '@causedeck/core/audit';
import { db } from '@causedeck/core/runtime';
import {
  asStaff,
  FLAG_KEYS,
  FLAGS,
  listFlagChangeRequests,
  listGlobalFlagRows,
  loadFlagRows,
  resolveFlag,
  setFlagAuditSink,
  type FlagKey,
  type FlagRow,
} from '@causedeck/flags';
import { consumeRateLimit } from '@causedeck/auth/rate-limit';
import { headers } from 'next/headers';

import { getAuth } from './auth.ts';
import { adminEnv, serverEnv } from './env.ts';
import { DEV_STAFF_EMAIL } from './roles.ts';
import type { StaffMember } from './staff.ts';
import { normaliseTotpCode, STAFF_TOTP_LIMIT, staffTotpRateLimitKey } from './two-factor.ts';

let installed = false;

/** Route every admin flag write's audit events to the audit log. Idempotent. */
export function installFlagAudit(): void {
  if (installed) return;
  setFlagAuditSink(flagChangeAuditSink);
  installed = true;
}

installFlagAudit();

/** One flag as the page shows it. Client-safe: no notes, no actor ids. */
export interface FlagRowView {
  key: FlagKey;
  description: string;
  legalGated: boolean;
  killSwitchEnv: string;
  /** `KILL_<KEY>` is set: the flag is off whatever the rows say. */
  killed: boolean;
  /** The global row's value; `null` when there is no row (registry default, off). */
  global: boolean | null;
  /** The selected workspace's override; `null` when there is none (or no workspace selected). */
  override: boolean | null;
  /** What the evaluator answers for this scope (global, or the selected workspace). */
  effective: boolean;
}

/** A legal-gated enable waiting for a second admin. */
export interface PendingRequestView {
  id: string;
  key: FlagKey;
  workspaceId: string | null;
  legalAckNote: string;
  requestedAt: string;
  /** The viewer made this request (they may withdraw it, never approve it). */
  own: boolean;
}

async function auditRead(staff: StaffMember, purpose: string, workspaceId?: string) {
  await record(
    {
      db,
      workspaceId: null,
      actor: { userId: staff.userId, kind: 'staff' },
      ...(staff.ip === undefined ? {} : { ip: staff.ip }),
      ...(staff.userAgent === undefined ? {} : { userAgent: staff.userAgent }),
      ...(staff.requestId === undefined ? {} : { requestId: staff.requestId }),
    },
    {
      action: 'staff.read',
      metadata: {
        purpose,
        capability: 'flags',
        tables:
          workspaceId === undefined
            ? 'feature_flag,flag_change_request'
            : 'feature_flag,workspace_feature_flag',
        role: staff.role,
        ...(workspaceId === undefined ? {} : { workspace: workspaceId }),
      },
    },
  );
}

const asRow = (
  enabled: boolean | undefined,
  legalAckBy: string | null = null,
): FlagRow | undefined => (enabled === undefined ? undefined : { enabled, legalAckBy });

/** Every registered flag with its global row, and the workspace's overrides when one is given. */
export async function flagRowsView(
  staff: StaffMember,
  workspaceId?: string,
): Promise<FlagRowView[]> {
  const env = serverEnv();
  const actor = asStaff(staff.userId);
  let global: Record<string, FlagRow>;
  let workspace: Record<string, FlagRow> = {};
  if (workspaceId === undefined) {
    await auditRead(staff, 'flags.list');
    const rows = await listGlobalFlagRows(db, actor);
    global = Object.fromEntries(
      rows.map((r) => [r.key, { enabled: r.enabled, legalAckBy: r.legalAckBy }]),
    );
  } else {
    await auditRead(staff, 'flags.workspace_overrides', workspaceId);
    const rows = await loadFlagRows(db, { workspaceId, userId: staff.userId });
    global = { ...rows.global };
    workspace = { ...rows.workspace };
  }
  return FLAG_KEYS.map((key) => {
    const def = FLAGS[key];
    const killed = killSwitch(def.killSwitchEnv, env);
    const g = global[key];
    const w = workspace[key];
    return {
      key,
      description: def.description,
      legalGated: def.legalGated,
      killSwitchEnv: def.killSwitchEnv,
      killed,
      global: g?.enabled ?? null,
      override: w?.enabled ?? null,
      effective: resolveFlag(def, {
        killed,
        global: asRow(g?.enabled, g?.legalAckBy),
        workspace: asRow(w?.enabled, w?.legalAckBy),
      }),
    };
  });
}

/** Pending legal-gated enables, oldest first, as `staff` sees them. */
export async function pendingRequestsView(staff: StaffMember): Promise<PendingRequestView[]> {
  const rows = await listFlagChangeRequests(db, asStaff(staff.userId));
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    workspaceId: r.workspaceId,
    legalAckNote: r.legalAckNote,
    requestedAt: r.requestedAt.toISOString(),
    own: r.requestedBy === staff.userId,
  }));
}

export type ReverifyResult = { ok: true } | { ok: false; error: string };

/**
 * 2FA re-verify for legal-gated changes: a fresh TOTP code for this session, checked by Better
 * Auth, under the same per-user limit as the console's TOTP step. The dev staff account skips it
 * outside production, as it skips the step itself (lib/staff.ts).
 */
export async function reverifyTotp(staff: StaffMember, raw: unknown): Promise<ReverifyResult> {
  const env = adminEnv();
  if (env.NODE_ENV !== 'production' && staff.email.toLowerCase() === DEV_STAFF_EMAIL) {
    return { ok: true };
  }
  const code = normaliseTotpCode(raw);
  if (code === null)
    return { ok: false, error: 'Enter the 6-digit code from your authenticator app.' };
  if (!(await consumeRateLimit(db, staffTotpRateLimitKey(staff.userId), STAFF_TOTP_LIMIT))) {
    return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' };
  }
  try {
    await getAuth().api.verifyTOTP({ body: { code }, headers: await headers() });
  } catch {
    return { ok: false, error: 'That code did not work. Try again.' };
  }
  return { ok: true };
}
