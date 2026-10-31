'use server';
// Practice-school progress (#703 R4, `/account`): mark one of the learning modules done, or undo
// it, for the signed-in user. Not workspace-scoped: progress belongs to the person. The module
// slug is validated against the closed list in `@causedeck/core/activation`, and the service only
// ever reads or writes the session user's own `learn_progress` rows (row-level security on
// `app.user_id`), so there is no id from the client that could name another user.
import { LEARN_MODULE_SLUGS } from '@causedeck/core/activation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { UnauthenticatedError } from '@causedeck/auth';

import { safeAction, type Result } from '../../../lib/safe-action.ts';

const SetLearnModuleDoneInput = z.object({
  slug: z.enum(LEARN_MODULE_SLUGS),
  done: z.boolean(),
});

export interface LearnModuleOutcome {
  slug: (typeof LEARN_MODULE_SLUGS)[number];
  done: boolean;
}

const setLearnModuleDone = safeAction(
  SetLearnModuleDoneInput,
  async ({ slug, done }, ctx): Promise<LearnModuleOutcome> => {
    if (!ctx.session) throw new UnauthenticatedError();
    const { db } = await import('@causedeck/core/runtime');
    const progress = await import('@causedeck/core/activation');
    const userId = ctx.session.user.id;
    if (done) await progress.markLearnModuleDone(db, { userId, slug });
    else await progress.unmarkLearnModule(db, { userId, slug });
    revalidatePath('/account');
    return { slug, done };
  },
);

// authz: public — self only: writes the session user's own progress row for a module from the
// closed list; a signed-out caller gets UNAUTHENTICATED and there is no target id to name.
export async function setLearnModuleDoneAction(raw: unknown): Promise<Result<LearnModuleOutcome>> {
  return setLearnModuleDone(raw);
}
