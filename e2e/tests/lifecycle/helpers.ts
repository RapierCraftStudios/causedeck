// Shared set-up for the lifecycle specs (#305). The e2e stack runs web servers only (no job
// worker), so the specs drive state with superuser SQL on the worker database (row-level security
// does not apply): the `workspace.export` flag row, the session's step-up stamp (#304) and the
// export job's progress as the `export.build` job would write it.
import { createHmac, randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';
import postgres from 'postgres';

import { E2E_WORKSPACES, e2eUser, expect, type E2eRole } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';

export const WORKSPACE = 'chennai-solo';
export const WORKSPACE_ID = E2E_WORKSPACES[WORKSPACE].id;
export const WORKSPACE_NAME = E2E_WORKSPACES[WORKSPACE].name;

export async function withSql<T>(
  database: string,
  fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

export const userId = (role: E2eRole) => e2eUser(role, WORKSPACE).id;

/** Turn `workspace.export` on for the workspace (fires `flag_changed`, which drops the cache). */
export function enableExport(database: string): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`
      insert into workspace_feature_flag (workspace_id, key, enabled, updated_by)
      values (${WORKSPACE_ID}, 'workspace.export', true, ${userId('owner')})`;
  });
}

/** Stamp (or clear) the step-up on every session of `role`: what a passkey or TOTP check writes. */
export function setStepUp(database: string, role: E2eRole, fresh: boolean): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`
      update session set step_up_at = ${fresh ? sql`now()` : null}
      where user_id = ${userId(role)}`;
  });
}

export interface ExportRow {
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  progress?: number;
  phase?: string;
  sizeBytes?: number;
  sha256?: string;
  /** Hours from now; negative is in the past. */
  expiresInHours?: number;
}

/** Insert an export of the owner's, as the build job leaves it; returns its id. */
export function insertExport(database: string, row: ExportRow): Promise<string> {
  return withSql(database, async (sql) => {
    const [inserted] = await sql<{ id: string }[]>`
      insert into export_job (workspace_id, requested_by, scope, status, progress, steps,
                              size_bytes, sha256, blob_id, expires_at, completed_at)
      values (${WORKSPACE_ID}, ${userId('owner')}, 'workspace', ${row.status}, ${row.progress ?? 0},
              ${sql.json(row.phase ? { phase: row.phase } : {})}, ${row.sizeBytes ?? null},
              ${row.sha256 ?? null}, ${row.status === 'ready' ? randomUUID() : null},
              ${row.expiresInHours === undefined ? null : sql`now() + make_interval(hours => ${row.expiresInHours})`},
              ${row.status === 'ready' || row.status === 'failed' ? sql`now()` : null})
      returning id`;
    if (!inserted) throw new Error('insertExport: no row');
    return inserted.id;
  });
}

/** Move an export along, as the build job would. */
export function updateExport(database: string, id: string, row: ExportRow): Promise<void> {
  return withSql(database, async (sql) => {
    await sql`
      update export_job set status = ${row.status}, progress = ${row.progress ?? 0},
        steps = ${sql.json(row.phase ? { phase: row.phase } : {})},
        size_bytes = ${row.sizeBytes ?? null}, sha256 = ${row.sha256 ?? null},
        blob_id = ${row.status === 'ready' ? randomUUID() : null},
        expires_at = ${row.expiresInHours === undefined ? null : sql`now() + make_interval(hours => ${row.expiresInHours})`}
      where id = ${id}`;
  });
}

/** Audit actions recorded in the workspace by `role`, newest first. */
export function auditActions(database: string, role: E2eRole): Promise<string[]> {
  return withSql(database, async (sql) => {
    const rows = await sql<{ action: string }[]>`
      select action from audit_event
      where workspace_id = ${WORKSPACE_ID} and actor_user_id = ${userId(role)}
      order by created_at desc`;
    return rows.map((r) => r.action);
  });
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret. */
export function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/**
 * Turn on TOTP for the signed-in user through the #289 setup dialog on `/account`, so the
 * lifecycle dialogs offer `Authenticator code`. Returns the base32 secret.
 */
export async function enrollTotp(page: Page): Promise<string> {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Set up' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set up two-factor authentication' });
  const secret = (await dialog.locator('[data-slot="two-factor-secret"]').textContent()) ?? '';
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('textbox', { name: 'Code' }).fill(totp(secret));
  await dialog.getByRole('button', { name: 'Verify' }).click();
  await expect(dialog.getByRole('list', { name: 'Backup codes' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return secret;
}

/** Complete `Confirm it is you` with an authenticator code inside `scope` (a dialog or card). */
export async function confirmWithCode(
  scope: ReturnType<Page['locator']>,
  secret: string,
): Promise<void> {
  await scope.getByRole('textbox', { name: 'Authenticator code' }).fill(totp(secret));
  await scope.getByRole('button', { name: 'Verify code' }).click();
}
