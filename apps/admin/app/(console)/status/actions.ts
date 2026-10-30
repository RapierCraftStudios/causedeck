'use server';
// Incident changes from the staff console (#770, part 2 of #96). Every action re-checks the staff
// member and the `status` capability (ops and admin), then writes through `@causedeck/core/status`,
// which checks `staff_user` again and records `incident.changed` in the same transaction. The next
// `system.status.publish` run puts the change on the public page. Results come back as
// `?done=` / `?error=` on the page, since the page is a server component.
import { db } from '@causedeck/core/runtime';
import {
  addIncidentUpdate,
  asIncidentStaff,
  createIncident,
  COMPONENT_IDS,
  INCIDENT_SEVERITIES,
  INCIDENT_TEMPLATES,
  IncidentAdminError,
  type IncidentTemplateId,
} from '@causedeck/core/status';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireStaff } from '../../../lib/staff.ts';

const PAGE = '/status';

const TEMPLATE_IDS = Object.keys(INCIDENT_TEMPLATES) as [
  IncidentTemplateId,
  ...IncidentTemplateId[],
];

const note = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v));

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  severity: z.enum(INCIDENT_SEVERITIES),
  component: z.enum(COMPONENT_IDS),
  template: z.enum(TEMPLATE_IDS).default('investigating'),
  note,
});

const updateSchema = z.object({
  id: z.uuid(),
  template: z.enum(TEMPLATE_IDS),
  note,
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
    if (error instanceof IncidentAdminError) return back('error', error.message);
    throw error;
  }
  return back('done', done);
}

/** Open an incident from a template; it reaches the public page on the next publish cycle. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('status')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function createIncidentAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('status');
  const parsed = createSchema.safeParse(
    fields(formData, ['title', 'severity', 'component', 'template', 'note']),
  );
  if (!parsed.success) {
    return back('error', 'Could not read that incident. Check the fields and try again.');
  }
  return run(
    () => createIncident(db, asIncidentStaff(staff.userId), parsed.data),
    'Incident opened. It appears on the status page within a minute.',
  );
}

/** Post an update from a template; the `resolved` template closes the incident. */
// authz: public to the product's policy (staff are not workspace members); requireStaff('status')
// below admits only enabled ops/admin staff past the console's 2FA step.
export async function updateIncidentAction(formData: FormData): Promise<void> {
  const staff = await requireStaff('status');
  const parsed = updateSchema.safeParse(fields(formData, ['id', 'template', 'note']));
  if (!parsed.success) return back('error', 'Could not read that update. Reload and try again.');
  const { id, ...input } = parsed.data;
  return run(
    () => addIncidentUpdate(db, asIncidentStaff(staff.userId), id, input),
    input.template === 'resolved'
      ? 'Incident resolved. It appears on the status page within a minute.'
      : 'Update posted. It appears on the status page within a minute.',
  );
}
