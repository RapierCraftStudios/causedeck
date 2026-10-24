'use server';
// Migration concierge actions (#685, part of #508): start a dry run or an import for a workspace,
// resume an interrupted import, roll one back. Each re-checks the staff member and the `migrations`
// capability, records `staff.read` (actor kind `staff`) and runs the core service as the workspace
// owner (core checks the role and keeps the run to the workspace). Nothing here reads a matter.
import {
  resumeMigrationRun,
  rollbackMigrationRun,
  startMigrationRun,
  MIGRATION_FIELDS,
  type ColumnMapping,
} from '@causedeck/core/migration';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { asMigrationOwner } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

const text = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

const workspaceOf = (formData: FormData): string => z.uuid().parse(text(formData, 'workspaceId'));

function mappingOf(formData: FormData): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const field of MIGRATION_FIELDS) {
    const header = text(formData, `map_${field}`).trim();
    if (header !== '') mapping[field] = header;
  }
  return mapping;
}

/** The uploaded CSV as text; null when missing or over the size cap. */
async function csvOf(formData: FormData): Promise<string | null> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_CSV_BYTES) return null;
  return file.text();
}

function failed(code: string): never {
  redirect(`/migrations?error=${code}`);
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.toLowerCase() : 'failed';
}

async function start(formData: FormData, mode: 'dry_run' | 'import'): Promise<void> {
  const staff = await requireStaff('migrations');
  const workspaceId = workspaceOf(formData);
  const csv = await csvOf(formData);
  if (csv === null) failed('file');
  const mapping = mappingOf(formData);
  let runId: string | undefined;
  try {
    const run = await asMigrationOwner(
      staff,
      `migrations.start_${mode}`,
      workspaceId,
      (deps, actor) => startMigrationRun(deps, actor, { mode, csv, mapping }),
    );
    if (run === null) failed('no_owner');
    runId = run.runId;
  } catch (error) {
    if ((error as Error).message === 'NEXT_REDIRECT') throw error;
    failed(codeOf(error));
  }
  revalidatePath('/migrations');
  redirect(`/migrations/${runId}?workspace=${workspaceId}`);
}

// authz: public to the product's policy (staff are not workspace members); requireStaff('migrations')
// admits only enabled ops/admin staff past the console's 2FA step.
export async function startDryRunAction(formData: FormData): Promise<void> {
  await start(formData, 'dry_run');
}

// authz: as startDryRunAction.
export async function startImportAction(formData: FormData): Promise<void> {
  await start(formData, 'import');
}

async function control(
  formData: FormData,
  purpose: string,
  run: typeof resumeMigrationRun,
): Promise<void> {
  const staff = await requireStaff('migrations');
  const workspaceId = workspaceOf(formData);
  const runId = z.uuid().parse(text(formData, 'runId'));
  try {
    await asMigrationOwner(staff, purpose, workspaceId, (deps, actor) =>
      run(deps, actor, { runId }),
    );
  } catch (error) {
    redirect(`/migrations/${runId}?workspace=${workspaceId}&error=${codeOf(error)}`);
  }
  revalidatePath(`/migrations/${runId}`);
  redirect(`/migrations/${runId}?workspace=${workspaceId}`);
}

// authz: as startDryRunAction.
export async function resumeRunAction(formData: FormData): Promise<void> {
  await control(formData, 'migrations.resume', resumeMigrationRun);
}

// authz: as startDryRunAction.
export async function rollbackRunAction(formData: FormData): Promise<void> {
  await control(formData, 'migrations.rollback', rollbackMigrationRun);
}
