// Cross-tenant case for askCopilot (#1115): workspace B naming workspace A or A's matter is
// denied before any retrieval or provider call, and A's usage and audit rows are unchanged.
// The registry case (SERVICE_TESTS.askCopilot) runs in src/__tests__/cross-tenant/services.test.ts.
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildMatter } from '@causedeck/db/testing/matter-graph-fixtures';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { failure, newWorkspace } from '../../../__tests__/fixtures.ts';
import { getUsage } from '../../../usage/index.ts';
import { askCopilot } from '../../ask.ts';

const NOW = new Date('2026-10-31T06:30:00.000Z');

const askedRows = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ id: schema.auditEvent.id })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.action, 'copilot.asked')),
  );

describe('askCopilot cross-tenant', () => {
  it.each([false, true])(
    "denies B naming A's workspace (with A's matter: %s); A's usage and audit are unchanged",
    async (withMatter) => {
      await withTestDb(async (tx) => {
        await seedPlans(tx);
        const a = await newWorkspace(tx);
        const b = await newWorkspace(tx);
        const matter = await inWorkspace(tx, a.workspaceId, (s) =>
          buildMatter(s, a.workspaceId, { title: 'A matter (fictional)' }),
        );
        const answer = vi.fn(() => Promise.resolve({ claims: [] }));
        const before = await askedRows(tx, a.workspaceId);

        const error = await failure(
          askCopilot(
            tx,
            { workspaceId: a.workspaceId, userId: b.ownerId },
            {
              question: 'surgery without consent',
              requestId: 'req-cross-tenant',
              ...(withMatter ? { matterId: matter.id } : {}),
            },
            { now: () => NOW, answer },
          ),
        );

        expect(error).toBeInstanceOf(Error);
        expect(answer).not.toHaveBeenCalled();
        expect(await getUsage({ db: tx, workspaceId: a.workspaceId }, 'copilot.questions')).toBe(0);
        expect(await askedRows(tx, a.workspaceId)).toEqual(before);
      });
    },
  );
});
