'use server';
// The review queue's staff actions (#518, D-049). Each re-checks the staff member and the
// `data-ops` capability (ops and admin); `@causedeck/core/review` records `staff.read` (actor kind
// `staff`, ids only) before it touches an item. A fix fans out to every watcher; send-to-workbench
// builds the redacted fixture from a document the reviewer supplies (never stored) and stamps the
// item, in one action, reusing the fixture workbench's builder.
import {
  buildFixture,
  WORKBENCH_ADAPTERS,
  WORKBENCH_FORMATS,
  WorkbenchError,
  type FixtureBundle,
} from '@causedeck/adapters/workbench';
import {
  assignReviewItem,
  dismissReviewItem,
  markFixtureExported,
  resolveReviewItem,
} from '@causedeck/core/review';
import { db } from '@causedeck/core/runtime';
import { WorkspaceError } from '@causedeck/core/workspaces';
import { REVIEW_FIELDS } from '@causedeck/db/schema';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireStaff } from '../../../lib/staff.ts';

export interface ReviewActionState {
  error?: string;
  built?: { bundle: FixtureBundle; redactions: { names: number; pii: number } };
}

const text = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
};

const idOf = (formData: FormData): string => z.string().uuid().parse(text(formData, 'id'));

function back(id: string): never {
  revalidatePath('/review');
  redirect(`/review/${id}`);
}

/** Take an item (or, with `release`, clear its assignee). */
// authz: public to the product's policy (staff are not workspace members); requireStaff('data-ops')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function assignReviewAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('data-ops');
  const id = idOf(formData);
  await assignReviewItem(db, staff, id, formData.has('release') ? null : staff.userId);
  back(id);
}

/** Close an item without a fix. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('data-ops')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function dismissReviewAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('data-ops');
  const id = idOf(formData);
  await dismissReviewItem(db, staff, id);
  back(id);
}

/** Submit the fix; it propagates to every workspace watching the record. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('data-ops')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function submitFixAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('data-ops');
  const id = idOf(formData);
  const field = z.enum(REVIEW_FIELDS).optional().catch(undefined).parse(text(formData, 'field'));
  const cnr = text(formData, 'cnr').trim();
  await resolveReviewItem(db, staff, id, {
    correctedValue: text(formData, 'correctedValue'),
    ...(cnr === '' ? {} : { cnr }),
    ...(field === undefined ? {} : { field }),
  });
  back(id);
}

/** Build the regression fixture for a fixed item and stamp it as exported. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('data-ops')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function sendToWorkbenchAction(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const staff = await requireStaff('data-ops');
  try {
    const id = idOf(formData);
    const adapterId = text(formData, 'adapterId');
    const format = z.enum(WORKBENCH_FORMATS).parse(text(formData, 'format'));
    const adapter = WORKBENCH_ADAPTERS[adapterId]?.();
    if (adapter === undefined) throw new WorkbenchError('Unknown adapter');
    const content = text(formData, 'document');
    if (content.trim() === '') throw new WorkbenchError('Add the document to label.');
    const name = z.string().trim().min(1).max(100).parse(text(formData, 'name'));
    const built = await buildFixture({ adapter, name, format, content });
    await markFixtureExported(db, staff, id);
    return { built: { bundle: built.bundle, redactions: built.redactions } };
  } catch (error) {
    if (error instanceof WorkbenchError || error instanceof WorkspaceError) {
      return { error: error.message };
    }
    if (error instanceof z.ZodError) return { error: 'Check the fields and try again.' };
    throw error;
  }
}
