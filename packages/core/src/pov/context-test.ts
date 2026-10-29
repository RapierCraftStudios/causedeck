// The context test (#86): an owner starts a timed run on a matter they chose, the tester answers
// the five standard questions with a stopwatch and marks each correct or not. Only ids, marks and
// times are stored, never the answers themselves.
import { schema, withWorkspace } from '@causedeck/db';
import { CONTEXT_TEST_QUESTIONS, type ContextTestAnswerEntry } from '@causedeck/validators';
import { and, eq } from 'drizzle-orm';

import { conflict, forbidden, invalid, notFound } from '../shared/errors.ts';

import { requirePovMember, type PovActor, type PovDeps } from './prefs.ts';

const { contextTestResult, matter } = schema;

/** The five standard questions, in the order they are asked. */
export const STANDARD_QUESTIONS = CONTEXT_TEST_QUESTIONS;

async function requireOwner(deps: PovDeps, actor: PovActor): Promise<string> {
  const who = await requirePovMember(deps.db, actor);
  if (who.role !== 'owner') throw forbidden();
  return who.memberId;
}

async function loadRun(deps: PovDeps, actor: PovActor, memberId: string, runId: string) {
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select()
      .from(contextTestResult)
      .where(
        and(
          eq(contextTestResult.workspaceId, actor.workspaceId),
          eq(contextTestResult.id, runId),
          eq(contextTestResult.memberId, memberId),
        ),
      ),
  );
  if (row === undefined) throw notFound('Run not found');
  return row;
}

/** Start a timed run on the chosen matter (owner only). */
export async function startContextTest(
  deps: PovDeps,
  actor: PovActor,
  input: { matterId: string },
): Promise<{ runId: string; startedAt: Date }> {
  const memberId = await requireOwner(deps, actor);
  const now = (deps.now ?? (() => new Date()))();
  const [found] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ id: matter.id })
      .from(matter)
      .where(and(eq(matter.workspaceId, actor.workspaceId), eq(matter.id, input.matterId))),
  );
  if (found === undefined) throw notFound('Matter not found');
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .insert(contextTestResult)
      .values({
        workspaceId: actor.workspaceId,
        matterId: input.matterId,
        memberId,
        startedAt: now,
      })
      .returning({ id: contextTestResult.id }),
  );
  if (row === undefined) throw notFound('Run not found');
  return { runId: row.id, startedAt: now };
}

/** Record the tester's self-mark for one question of a running test; a repeat replaces it. */
export async function answerQuestion(
  deps: PovDeps,
  actor: PovActor,
  input: { runId: string } & ContextTestAnswerEntry,
): Promise<{ answered: number }> {
  const memberId = await requireOwner(deps, actor);
  const run = await loadRun(deps, actor, memberId, input.runId);
  if (run.finishedAt !== null) throw conflict('The run is finished');
  const kept = (run.questions as ContextTestAnswerEntry[]).filter(
    (q) => q.question !== input.question,
  );
  const questions = [
    ...kept,
    { question: input.question, correct: input.correct, atMs: input.atMs },
  ];
  await withWorkspace(deps.db, actor, (tx) =>
    tx
      .update(contextTestResult)
      .set({ questions })
      .where(
        and(
          eq(contextTestResult.workspaceId, actor.workspaceId),
          eq(contextTestResult.id, input.runId),
        ),
      ),
  );
  return { answered: questions.length };
}

/** Stop the stopwatch: all five questions must be answered. */
export async function finishContextTest(
  deps: PovDeps,
  actor: PovActor,
  input: { runId: string },
): Promise<{ elapsedMs: number; correct: number }> {
  const memberId = await requireOwner(deps, actor);
  const now = (deps.now ?? (() => new Date()))();
  const run = await loadRun(deps, actor, memberId, input.runId);
  if (run.finishedAt !== null) throw conflict('The run is finished');
  const questions = run.questions as ContextTestAnswerEntry[];
  if (questions.length < STANDARD_QUESTIONS.length) throw invalid('Answer all five questions');
  const elapsedMs = Math.max(0, now.getTime() - run.startedAt.getTime());
  await withWorkspace(deps.db, actor, (tx) =>
    tx
      .update(contextTestResult)
      .set({ finishedAt: now, elapsedMs })
      .where(
        and(
          eq(contextTestResult.workspaceId, actor.workspaceId),
          eq(contextTestResult.id, input.runId),
        ),
      ),
  );
  return { elapsedMs, correct: questions.filter((q) => q.correct).length };
}
