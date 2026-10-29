// The staff write path of the public status page's incident log (#770, part 2 of #96). Staff open,
// update and resolve incidents from fixed message templates (public wording is never free text,
// apart from an optional note); each change is one transaction that checks the staff member, writes
// `incident` / `incident_update` and records `incident.changed`, so a failed audit rolls it back.
// The next `system.status.publish` run (publish.ts) picks the rows up.
import { schema, withUser, type Queryable, type Transaction } from '@causedeck/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { COMPONENT_IDS, type ComponentId, type IncidentState } from './model.ts';

const { incident, incidentUpdate, staffUser } = schema;

export const INCIDENT_SEVERITIES = schema.INCIDENT_SEVERITIES;
export type IncidentSeverity = schema.IncidentSeverity;

/** The public wording per state; the console offers these and an optional note, nothing else. */
export const INCIDENT_TEMPLATES = {
  investigating: {
    label: 'Investigating',
    state: 'investigating',
    body: 'We are investigating an issue affecting this component.',
  },
  identified: {
    label: 'Identified',
    state: 'identified',
    body: 'We have identified the cause and are working on a fix.',
  },
  monitoring: {
    label: 'Monitoring',
    state: 'monitoring',
    body: 'A fix has been applied and we are monitoring the result.',
  },
  resolved: {
    label: 'Resolved',
    state: 'resolved',
    body: 'This incident has been resolved.',
  },
} as const satisfies Record<IncidentState, { label: string; state: IncidentState; body: string }>;
export type IncidentTemplateId = keyof typeof INCIDENT_TEMPLATES;

const NOTE_MAX = 500;
const TITLE_MAX = 200;

export type IncidentAdminErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID' | 'RESOLVED';

export class IncidentAdminError extends Error {
  readonly code: IncidentAdminErrorCode;

  constructor(code: IncidentAdminErrorCode, message: string) {
    super(message);
    this.name = 'IncidentAdminError';
    this.code = code;
  }
}

/** The staff member making a change; `asIncidentStaff` is the only way to build one. */
export interface IncidentActor {
  userId: string;
}

export function asIncidentStaff(userId: string): IncidentActor {
  return { userId };
}

export interface IncidentInput {
  title: string;
  severity: IncidentSeverity;
  component: ComponentId;
  /** Opening message; defaults to the `investigating` template. */
  template?: IncidentTemplateId;
  note?: string | null;
}

export interface IncidentUpdateInput {
  template: IncidentTemplateId;
  note?: string | null;
}

export interface IncidentRecord {
  id: string;
  title: string;
  severity: IncidentSeverity;
  state: IncidentState;
  component: string;
  startedAt: Date;
  resolvedAt: Date | null;
  updates: { state: IncidentState; body: string; createdAt: Date }[];
}

function invalid(message: string): never {
  throw new IncidentAdminError('INVALID', message);
}

/** The template wording plus the optional note, as one public message. */
function messageFor(templateId: unknown, note: string | null | undefined) {
  if (typeof templateId !== 'string' || !Object.hasOwn(INCIDENT_TEMPLATES, templateId)) {
    invalid('Choose a message template');
  }
  const template = INCIDENT_TEMPLATES[templateId as IncidentTemplateId];
  const trimmed = (note ?? '').trim();
  if (trimmed.length > NOTE_MAX) invalid(`The note must be at most ${String(NOTE_MAX)} characters`);
  return {
    state: template.state,
    body: trimmed === '' ? template.body : `${template.body} ${trimmed}`,
  };
}

async function assertIncidentStaff(tx: Transaction, actor: IncidentActor): Promise<void> {
  const [row] = await tx
    .select({ userId: staffUser.userId })
    .from(staffUser)
    .where(
      and(
        eq(staffUser.userId, actor.userId),
        inArray(staffUser.role, ['ops', 'admin']),
        isNull(staffUser.disabledAt),
      ),
    );
  if (!row)
    throw new IncidentAdminError('FORBIDDEN', 'Only ops or admin staff can change incidents');
}

function audit(
  tx: Transaction,
  actor: IncidentActor,
  incidentId: string,
  change: 'created' | 'updated' | 'resolved',
  oldState: IncidentState | null,
  newState: IncidentState,
): Promise<void> {
  return record(
    { db: tx, workspaceId: null, actor: { userId: actor.userId, kind: 'staff' } },
    {
      action: 'incident.changed',
      target: { kind: 'incident', id: incidentId },
      metadata: { change, old_state: oldState, new_state: newState },
    },
  );
}

/** Open an incident (staff only), audited, with its first public update. */
export async function createIncident(
  db: Queryable,
  actor: IncidentActor,
  input: IncidentInput,
): Promise<IncidentRecord> {
  const title = input.title.trim();
  if (title === '' || title.length > TITLE_MAX) {
    invalid(`The title must be 1 to ${String(TITLE_MAX)} characters`);
  }
  if (!(INCIDENT_SEVERITIES as readonly string[]).includes(input.severity)) {
    invalid('Choose a severity');
  }
  if (!(COMPONENT_IDS as readonly string[]).includes(input.component)) {
    invalid('Choose a component');
  }
  const message = messageFor(input.template ?? 'investigating', input.note);
  if (message.state === 'resolved') invalid('An incident cannot be opened as resolved');
  return withUser(db, { userId: actor.userId }, async (tx) => {
    await assertIncidentStaff(tx, actor);
    const [row] = await tx
      .insert(incident)
      .values({
        title,
        severity: input.severity,
        component: input.component,
        state: message.state,
        createdBy: actor.userId,
      })
      .returning();
    if (!row) throw new Error('incident insert returned no row');
    const [update] = await tx
      .insert(incidentUpdate)
      .values({
        incidentId: row.id,
        state: message.state,
        body: message.body,
        createdBy: actor.userId,
      })
      .returning();
    if (!update) throw new Error('incident_update insert returned no row');
    await audit(tx, actor, row.id, 'created', null, message.state);
    return { ...row, updates: [update] };
  });
}

/** Move an incident to a new state with a template message (`resolved` closes it), audited. */
export async function addIncidentUpdate(
  db: Queryable,
  actor: IncidentActor,
  incidentId: string,
  input: IncidentUpdateInput,
): Promise<IncidentRecord> {
  const message = messageFor(input.template, input.note);
  return withUser(db, { userId: actor.userId }, async (tx) => {
    await assertIncidentStaff(tx, actor);
    const [existing] = await tx.select().from(incident).where(eq(incident.id, incidentId));
    if (!existing) throw new IncidentAdminError('NOT_FOUND', 'That incident does not exist');
    if (existing.state === 'resolved') {
      throw new IncidentAdminError('RESOLVED', 'A resolved incident cannot be updated');
    }
    const now = new Date();
    const [row] = await tx
      .update(incident)
      .set({
        state: message.state,
        resolvedAt: message.state === 'resolved' ? now : null,
        updatedAt: now,
      })
      .where(eq(incident.id, incidentId))
      .returning();
    if (!row) throw new IncidentAdminError('NOT_FOUND', 'That incident does not exist');
    const [update] = await tx
      .insert(incidentUpdate)
      .values({ incidentId, state: message.state, body: message.body, createdBy: actor.userId })
      .returning();
    if (!update) throw new Error('incident_update insert returned no row');
    await audit(
      tx,
      actor,
      incidentId,
      message.state === 'resolved' ? 'resolved' : 'updated',
      existing.state,
      message.state,
    );
    const earlier = await tx
      .select()
      .from(incidentUpdate)
      .where(eq(incidentUpdate.incidentId, incidentId));
    return {
      ...row,
      updates: earlier.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    };
  });
}

/** Every incident, newest first, with its updates oldest first. */
export async function listIncidents(db: Queryable): Promise<IncidentRecord[]> {
  const rows = await db.select().from(incident).orderBy(desc(incident.startedAt)).limit(100);
  if (rows.length === 0) return [];
  const updates = await db
    .select()
    .from(incidentUpdate)
    .where(
      inArray(
        incidentUpdate.incidentId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((row) => ({
    ...row,
    updates: updates
      .filter((u) => u.incidentId === row.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  }));
}
