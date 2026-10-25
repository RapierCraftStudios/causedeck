'use server';
// Source registry changes from the staff console (#478, D-048). Every action re-checks the staff
// member and the `sources` capability (ops and admin), then writes through `@causedeck/core/sources`,
// which validates again (court and notice sources never get the captcha tier) and records
// `source.changed` with the old and new value of every changed field in the same transaction.
// Results come back as `?done=` / `?error=` on the page, since the page is a server component.
import { db } from '@causedeck/core/runtime';
import {
  asSourceStaff,
  createSource,
  setSourceKillSwitch,
  SOURCE_ACCESS_MODES,
  SOURCE_KINDS,
  SOURCE_MAX_TIERS,
  SOURCE_REVIEW_STATUSES,
  SourceAdminError,
  updateSource,
} from '@causedeck/core/sources';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireStaff } from '../../../lib/staff.ts';

const PAGE = '/sources';

const idField = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)*$/);

const sourceFields = z.object({
  kind: z.enum(SOURCE_KINDS),
  baseUrl: z.string().trim().min(1).max(2000),
  owner: z.string().trim().min(1).max(200),
  accessMode: z.enum(SOURCE_ACCESS_MODES),
  termsStatus: z.enum(SOURCE_REVIEW_STATUSES),
  counselStatus: z.enum(SOURCE_REVIEW_STATUSES),
  rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000),
  retentionDays: z.coerce.number().int().min(0).max(36_500),
  residency: z.string().trim().min(1).max(50),
  maxTier: z.enum(SOURCE_MAX_TIERS),
  maxCostDollars: z.coerce.number().min(0).max(1_000_000),
  killSwitch: z.enum(['true', 'false']).transform((v) => v === 'true'),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === '' ? null : v)),
});

const FIELD_NAMES = [
  'kind',
  'baseUrl',
  'owner',
  'accessMode',
  'termsStatus',
  'counselStatus',
  'rateLimitPerMinute',
  'retentionDays',
  'residency',
  'maxTier',
  'maxCostDollars',
  'killSwitch',
  'notes',
] as const;

const killSwitchSchema = z.object({
  id: idField,
  killSwitch: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

const fields = (formData: FormData, names: readonly string[]) =>
  Object.fromEntries(names.flatMap((n) => (formData.has(n) ? [[n, formData.get(n)]] : [])));

function back(kind: 'done' | 'error', message: string): never {
  revalidatePath(PAGE);
  return redirect(`${PAGE}?${kind}=${encodeURIComponent(message)}`);
}

async function run(fn: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof SourceAdminError) return back('error', error.message);
    throw error;
  }
  return back('done', done);
}

/** Add a source (`mode=create`) or edit one (`mode=update`); the id is the source's slug. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('sources')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function saveSourceAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('sources');
  const id = idField.safeParse(formData.get('id'));
  const parsed = sourceFields.safeParse(fields(formData, FIELD_NAMES));
  if (!id.success || !parsed.success) {
    return back('error', 'Could not read that source. Check the fields and try again.');
  }
  const actor = asSourceStaff(staff.userId);
  if (formData.get('mode') === 'create') {
    return run(() => createSource(db, actor, id.data, parsed.data), `${id.data} added.`);
  }
  return run(() => updateSource(db, actor, id.data, parsed.data), `${id.data} saved.`);
}

/** Flip a source's kill switch: on stops every fetch from it at once. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('sources')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function setSourceKillSwitchAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('sources');
  const parsed = killSwitchSchema.safeParse(fields(formData, ['id', 'killSwitch']));
  if (!parsed.success) return back('error', 'Could not read that change. Reload and try again.');
  const { id, killSwitch } = parsed.data;
  return run(
    () => setSourceKillSwitch(db, asSourceStaff(staff.userId), id, killSwitch),
    `${id} kill switch is now ${killSwitch ? 'on' : 'off'}.`,
  );
}
