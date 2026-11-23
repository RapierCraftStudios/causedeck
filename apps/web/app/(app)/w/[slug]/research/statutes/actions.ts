'use server';
// Statute section server action (#1126, part 4 of #1116; D-053, D-001 amended / ADR 0051). Goes
// through `workspaceAction`: zod input, session, membership and `matter.read`; the statutes service
// asserts membership again. It reads only global rows (statute text, the anonymised corpus) and
// writes nothing: no audit event or log line carries a section, its text or a judgment.
import type {
  SectionAuthority,
  SectionHistoryView,
  SectionView,
} from '@causedeck/core/statutes';
import { z } from 'zod';

import type { Result } from '../../../../../../lib/safe-action.ts';
import { ActionError } from '../../../../../../lib/safe-action.ts';
import { WorkspaceScoped, workspaceAction } from '../../../../../../lib/workspace-action.ts';

/** Everything the section page shows: the text in force, every version and the top authorities. */
export interface SectionPageData {
  section: SectionView;
  history: SectionHistoryView | null;
  authorities: SectionAuthority[];
}

const SectionInput = WorkspaceScoped.extend({
  /** An act short name (`bnss`) or its statute key; normalised by the service. */
  act: z.string().trim().min(1).max(200),
  section: z.string().trim().min(1).max(40),
});

const get = workspaceAction(
  SectionInput,
  async (input, ctx): Promise<SectionPageData> => {
    const { getSection, listSectionHistory, topAuthoritiesForSection } =
      await import('@causedeck/core/statutes');
    const actor = { workspaceId: ctx.workspaceId, userId: ctx.userId };
    const ref = { statute: input.act, section: input.section };
    const section = await getSection(ctx.tx, actor, ref);
    if (section === null) throw new ActionError('NOT_FOUND', 'This section is not stored.');
    const history = await listSectionHistory(ctx.tx, actor, ref);
    const authorities = await topAuthoritiesForSection(ctx.tx, actor, ref);
    return { section, history, authorities };
  },
  { action: 'matter.read' },
);

export async function getSectionAction(raw: unknown): Promise<Result<SectionPageData>> {
  return get(raw);
}
