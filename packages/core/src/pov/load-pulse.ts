// The weekly load pulse (#86): three 1-5 items, once per IST ISO week from Monday 06:00, dismissible,
// stored per member. A dismissal is a row too, so it is not asked again that week.
import { schema, withWorkspace } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';

import { forbidden } from '../shared/errors.ts';

import { promptsEnabled, requirePovMember, type PovActor, type PovDeps } from './prefs.ts';
import { isBaseline, isoWeekIst, pulseWindowOpen } from './time.ts';

const { loadPulse, organization } = schema;

/** Whether the actor's pulse for this week is due: on, not a viewer, window open, no row yet. */
export async function dueForPulse(deps: PovDeps, actor: PovActor): Promise<boolean> {
  const who = await requirePovMember(deps.db, actor);
  if (who.role === 'viewer') return false;
  const now = (deps.now ?? (() => new Date()))();
  if (!pulseWindowOpen(now)) return false;
  if (!(await promptsEnabled(deps.db, actor, who.memberId))) return false;
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ id: loadPulse.id })
      .from(loadPulse)
      .where(
        and(
          eq(loadPulse.workspaceId, actor.workspaceId),
          eq(loadPulse.memberId, who.memberId),
          eq(loadPulse.isoWeek, isoWeekIst(now)),
        ),
      ),
  );
  return row === undefined;
}

async function write(
  deps: PovDeps,
  actor: PovActor,
  answer: {
    demand: number | null;
    worry: number | null;
    effort: number | null;
    dismissed: boolean;
  },
): Promise<{ isoWeek: string }> {
  const who = await requirePovMember(deps.db, actor);
  if (who.role === 'viewer') throw forbidden('Viewers are not asked');
  const now = (deps.now ?? (() => new Date()))();
  const isoWeek = isoWeekIst(now);
  const [org] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ createdAt: organization.createdAt })
      .from(organization)
      .where(eq(organization.id, actor.workspaceId)),
  );
  const values = {
    demand: answer.demand,
    worry: answer.worry,
    effort: answer.effort,
    dismissedAt: answer.dismissed ? now : null,
  };
  await withWorkspace(deps.db, actor, (tx) =>
    tx
      .insert(loadPulse)
      .values({
        workspaceId: actor.workspaceId,
        memberId: who.memberId,
        isoWeek,
        baseline: org === undefined ? false : isBaseline(org.createdAt, now),
        createdAt: now,
        updatedAt: now,
        ...values,
      })
      .onConflictDoUpdate({
        target: [loadPulse.workspaceId, loadPulse.memberId, loadPulse.isoWeek],
        set: { ...values, updatedAt: now },
      }),
  );
  return { isoWeek };
}

/** Store this week's answers (a second submit the same week replaces the first). */
export function recordLoadPulse(
  deps: PovDeps,
  actor: PovActor,
  input: { demand: number; worry: number; effort: number },
): Promise<{ isoWeek: string }> {
  return write(deps, actor, { ...input, dismissed: false });
}

/** Dismiss this week's card: it does not return until next week. */
export function dismissLoadPulse(deps: PovDeps, actor: PovActor): Promise<{ isoWeek: string }> {
  return write(deps, actor, { demand: null, worry: null, effort: null, dismissed: true });
}
