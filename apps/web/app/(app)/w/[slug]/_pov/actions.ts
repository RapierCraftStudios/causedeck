'use server';
// Proof-of-value server actions (#86). Each goes through `workspaceAction` (zod input with the
// workspace id, session, membership); the pov service then applies the role rules itself (a viewer
// is not asked, the context test and the report are owner-only, the aggregate is owner and
// advocates). Nothing here sends data out of the workspace: the report is returned to the caller.
import {
  answerQuestion,
  buildPovReport,
  deleteOwnRating,
  dismissLoadPulse,
  finishContextTest,
  getPovPrefs,
  listPov,
  povAggregate,
  recordLoadPulse,
  recordPreparedness,
  recordSkip,
  setPovPrefs,
  startContextTest,
  type OwnPov,
  type PovAggregate,
} from '@causedeck/core/pov';
import {
  ContextTestAnswerInput,
  ContextTestFinish,
  ContextTestStart,
  LoadPulse,
  PovDeleteRating,
  PovPrefs,
  PreparednessRating,
  PreparednessSkip,
} from '@causedeck/validators';
import { z } from 'zod';

import { type Result } from '../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../lib/workspace-action.ts';

const scoped = <T extends z.ZodRawShape>(shape: T) => WorkspaceScoped.extend(shape).strict();
const deps = (ctx: { tx: unknown }) => ({ db: ctx.tx as Parameters<typeof listPov>[0]['db'] });
const who = (ctx: { userId: string; workspaceId: string }) => ({
  userId: ctx.userId,
  workspaceId: ctx.workspaceId,
});

const rate = workspaceAction(scoped(PreparednessRating.shape), (input, ctx) =>
  recordPreparedness(deps(ctx), who(ctx), {
    hearingId: input.hearingId,
    rating: input.rating,
    ...(input.note === undefined ? {} : { note: input.note }),
  }),
);
const skip = workspaceAction(scoped(PreparednessSkip.shape), (input, ctx) =>
  recordSkip(deps(ctx), who(ctx), input),
);
const pulse = workspaceAction(scoped(LoadPulse.shape), (input, ctx) =>
  recordLoadPulse(deps(ctx), who(ctx), input),
);
const dismiss = workspaceAction(scoped({}), (_input, ctx) => dismissLoadPulse(deps(ctx), who(ctx)));
const start = workspaceAction(scoped(ContextTestStart.shape), (input, ctx) =>
  startContextTest(deps(ctx), who(ctx), input),
);
const answer = workspaceAction(scoped(ContextTestAnswerInput.shape), (input, ctx) =>
  answerQuestion(deps(ctx), who(ctx), input),
);
const finish = workspaceAction(scoped(ContextTestFinish.shape), (input, ctx) =>
  finishContextTest(deps(ctx), who(ctx), input),
);
const prefs = workspaceAction(scoped(PovPrefs.shape), (input, ctx) =>
  setPovPrefs(deps(ctx), who(ctx), input),
);
const readPrefs = workspaceAction(scoped({}), (_input, ctx) => getPovPrefs(deps(ctx), who(ctx)));
const own = workspaceAction(scoped({ memberId: z.uuid().optional() }), (input, ctx) =>
  listPov(deps(ctx), who(ctx), input.memberId === undefined ? {} : { memberId: input.memberId }),
);
const remove = workspaceAction(scoped(PovDeleteRating.shape), async (input, ctx) => {
  await deleteOwnRating(deps(ctx), who(ctx), input);
  return { deleted: true as const };
});
const aggregate = workspaceAction(scoped({}), (_input, ctx) => povAggregate(deps(ctx), who(ctx)));
const report = workspaceAction(scoped({}), async (_input, ctx) => ({
  csv: await buildPovReport(deps(ctx), who(ctx)),
}));

export async function ratePreparednessAction(raw: unknown): Promise<Result<{ id: string }>> {
  return rate(raw);
}
export async function skipPreparednessAction(raw: unknown): Promise<Result<{ id: string }>> {
  return skip(raw);
}
export async function submitLoadPulseAction(raw: unknown): Promise<Result<{ isoWeek: string }>> {
  return pulse(raw);
}
export async function dismissLoadPulseAction(raw: unknown): Promise<Result<{ isoWeek: string }>> {
  return dismiss(raw);
}
export async function startContextTestAction(
  raw: unknown,
): Promise<Result<{ runId: string; startedAt: Date }>> {
  return start(raw);
}
export async function answerContextTestAction(raw: unknown): Promise<Result<{ answered: number }>> {
  return answer(raw);
}
export async function finishContextTestAction(
  raw: unknown,
): Promise<Result<{ elapsedMs: number; correct: number }>> {
  return finish(raw);
}
export async function setPovPrefsAction(
  raw: unknown,
): Promise<Result<{ promptsEnabled: boolean }>> {
  return prefs(raw);
}
export async function getPovPrefsAction(
  raw: unknown,
): Promise<Result<{ promptsEnabled: boolean }>> {
  return readPrefs(raw);
}
export async function listOwnPovAction(raw: unknown): Promise<Result<OwnPov>> {
  return own(raw);
}
export async function deleteOwnRatingAction(raw: unknown): Promise<Result<{ deleted: true }>> {
  return remove(raw);
}
export async function povAggregateAction(raw: unknown): Promise<Result<PovAggregate>> {
  return aggregate(raw);
}
export async function downloadPovReportAction(raw: unknown): Promise<Result<{ csv: string }>> {
  return report(raw);
}
