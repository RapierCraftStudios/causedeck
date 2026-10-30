'use server';
// Limitation rule table import (#942, part of #84): staff paste a counsel rule table (JSON) for a
// workspace. Each action re-checks the staff member and the `limitation-rules` capability, records
// `staff.read` (actor kind `staff`) and runs the core service as the workspace owner. Core
// validates the table and stores every rule as an unreviewed draft (`reviewed = false`): a draft
// never feeds a computation, and nothing here marks a rule reviewed (that is counsel's sign-off,
// #120). Results come back as `?done=` / `?error=` on the page.
import { loadRuleTable } from '@causedeck/core/limitation';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { asLimitationOwner } from '../../../lib/data/index.ts';
import { requireStaff } from '../../../lib/staff.ts';

const MAX_TABLE_CHARS = 200_000;

const text = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

function back(workspaceId: string, kind: 'done' | 'error', message: string): never {
  revalidatePath('/limitation-rules');
  return redirect(
    `/limitation-rules?workspace=${workspaceId}&${kind}=${encodeURIComponent(message)}`,
  );
}

function codeOf(error: unknown): string {
  if (error instanceof Error && error.name === 'LimitationDisabledError') return 'disabled';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.toLowerCase() : 'failed';
}

/** Import the pasted rule table into the workspace as unreviewed drafts. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('limitation-rules')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function importRuleTableAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('limitation-rules');
  const workspace = z.uuid().safeParse(text(formData, 'workspaceId').trim());
  if (!workspace.success) return redirect('/limitation-rules?error=workspace');
  const workspaceId = workspace.data.toLowerCase();
  const raw = text(formData, 'table').trim();
  if (raw === '' || raw.length > MAX_TABLE_CHARS) return back(workspaceId, 'error', 'table');
  let table: unknown;
  try {
    table = JSON.parse(raw);
  } catch {
    return back(workspaceId, 'error', 'json');
  }
  let result: Awaited<ReturnType<typeof loadRuleTable>> | null;
  try {
    result = await asLimitationOwner(staff, 'limitation_rules.import', workspaceId, (deps, actor) =>
      loadRuleTable(deps, actor, table),
    );
  } catch (error) {
    return back(workspaceId, 'error', codeOf(error));
  }
  if (result === null) return back(workspaceId, 'error', 'no_owner');
  return back(
    workspaceId,
    'done',
    [result.version, String(result.imported), String(result.skipped)].join(':'),
  );
}
