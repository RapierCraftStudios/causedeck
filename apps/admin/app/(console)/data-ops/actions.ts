'use server';
// Starts the bulk judgment import from the staff console (#890, D-053). The action re-checks the
// staff member and the `data-ops` capability, audits the start (dataset, court and year range only)
// and enqueues `system.corpus.bulk-import`. The job itself refuses an uncleared or killed source.
import { record } from '@causedeck/core/audit';
import { enqueue } from '@causedeck/core/jobs';
import { db } from '@causedeck/core/runtime';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireStaff } from '../../../lib/staff.ts';

const PAGE = '/data-ops';

const optionalYear = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : Number(v)))
  .pipe(z.number().int().min(1947).max(2100).optional());

const startSchema = z
  .object({
    dataset: z.enum(['sc', 'hc']),
    court: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_~-]{1,40}$/)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    yearFrom: optionalYear,
    yearTo: optionalYear,
  })
  .refine((p) => (p.yearFrom === undefined) === (p.yearTo === undefined), 'years go together')
  .refine((p) => p.yearFrom === undefined || p.yearTo === undefined || p.yearFrom <= p.yearTo)
  .refine((p) => p.dataset === 'hc' || p.court === undefined);

function back(kind: 'done' | 'error', message: string): never {
  revalidatePath(PAGE);
  return redirect(`${PAGE}?${kind}=${encodeURIComponent(message)}`);
}

/** Queue a bulk import for one dataset, optionally one court and a year range. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('data-ops')
// below admits only enabled staff whose role reaches Data Ops.
export async function startBulkImportAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('data-ops');
  const parsed = startSchema.safeParse({
    dataset: formData.get('dataset'),
    court: formData.get('court') ?? '',
    yearFrom: formData.get('yearFrom') ?? '',
    yearTo: formData.get('yearTo') ?? '',
  });
  if (!parsed.success) return back('error', 'Could not read that import. Check the fields.');
  const { dataset, court, yearFrom, yearTo } = parsed.data;
  await record(
    { db, workspaceId: null, actor: { userId: staff.userId, kind: 'staff' } },
    {
      action: 'corpus.bulk_import_started',
      target: { kind: 'source', id: `aws-open-data-${dataset}` },
      metadata: {
        dataset,
        court: court ?? null,
        yearFrom: yearFrom ?? null,
        yearTo: yearTo ?? null,
      },
    },
  );
  await enqueue('system.corpus.bulk-import', {
    dataset,
    ...(court === undefined ? {} : { court }),
    ...(yearFrom === undefined || yearTo === undefined ? {} : { yearFrom, yearTo }),
  });
  return back('done', `Bulk import of ${dataset} queued.`);
}
