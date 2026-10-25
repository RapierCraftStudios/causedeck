// Cross-tenant obligation service (#67): user `ub` (and `uboth`, a member of both workspaces but
// acting in B) calls the service with workspace A's ids. Mutations must be denied and leave A's rows
// unchanged; the queue and direct SQL from B's scope never return A's rows.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../../index.ts';
import {
  closeObligation,
  cureDefect,
  listCertifiedCopies,
  listDefects,
  obligationOptions,
  queryQueue,
  queryQueueView,
  reopenObligation,
  transitionCertifiedCopy,
  updateObligation,
} from '../../obligations/index.ts';
import { failure } from '../fixtures.ts';

const NOW = new Date('2026-11-10T06:00:00Z');
const deps = (tx: Transaction) => ({ db: tx, now: () => NOW });

async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error = await failure(promise);
  expect(error, 'expected NOT_FOUND, FORBIDDEN or VALIDATION').toBeInstanceOf(WorkspaceError);
  expect(['NOT_FOUND', 'FORBIDDEN', 'VALIDATION']).toContain((error as WorkspaceError).code);
}

describe('cross-tenant: obligations (#67)', () => {
  for (const who of ['ub', 'uboth'] as const) {
    it(`${who} in B cannot read or mutate A's obligations, defects or copies`, async () => {
      await withTestDb(async (tx) => {
        const t = await seedTwoTenants(tx);
        const userId = t[who];
        const actor = { userId, workspaceId: t.b.id };
        const aObligation = String(t.a.rows.obligation?.obligationId);
        const aDefect = String(t.a.rows.defect?.defectId);
        const aCopy = String(t.a.rows.certified_copy?.certifiedCopyId);
        const snapshot = () =>
          inWorkspace(tx, t.a.id, async (s) => ({
            obligations: await s.select().from(schema.obligation).orderBy(schema.obligation.id),
            events: await s.select().from(schema.obligationEvent),
            defects: await s.select().from(schema.defect),
            copies: await s.select().from(schema.certifiedCopy),
          }));
        const before = await snapshot();

        await expectDenied(
          closeObligation(deps(tx), actor, aObligation, { reason: 'lawyer_action', note: 'x' }),
        );
        await expectDenied(
          updateObligation(deps(tx), actor, aObligation, { description: 'hijacked' }),
        );
        await expectDenied(reopenObligation(deps(tx), actor, aObligation, { reason: 'x' }));
        await expectDenied(
          cureDefect(deps(tx), actor, { defectId: aDefect, curedOn: '2026-11-10' }),
        );
        await expectDenied(
          transitionCertifiedCopy(deps(tx), actor, {
            certifiedCopyId: aCopy,
            to: 'ready',
            on: '2026-11-10',
            sourceRef: 'registry note',
          }),
        );

        const queue = await queryQueue(deps(tx), actor);
        const ids = Object.values(queue)
          .flat()
          .map((row) => row.id);
        expect(ids).not.toContain(aObligation);

        // The read models of the queue screen (#68) show none of A's rows either.
        const view = await queryQueueView(deps(tx), actor);
        expect(
          Object.values(view)
            .flat()
            .map((row) => row.id),
        ).not.toContain(aObligation);
        expect((await listDefects(deps(tx), actor)).map((d) => d.id)).not.toContain(aDefect);
        expect((await listCertifiedCopies(deps(tx), actor)).map((c) => c.id)).not.toContain(aCopy);
        const options = await obligationOptions(deps(tx), actor);
        expect(options.matters.map((m) => m.id)).not.toContain(t.a.rows.matter?.matterId ?? 'none');

        // Direct SQL from B's scope sees none of A's rows and changes none.
        const seen = await inWorkspace(tx, t.b.id, (s) =>
          s.select().from(schema.obligation).where(eq(schema.obligation.id, aObligation)),
        );
        expect(seen).toEqual([]);
        const updated = await inWorkspace(tx, t.b.id, (s) =>
          s
            .update(schema.obligation)
            .set({ description: 'hijacked' })
            .where(eq(schema.obligation.id, aObligation))
            .returning({ id: schema.obligation.id }),
        );
        expect(updated).toEqual([]);

        expect(await snapshot()).toEqual(before);
      });
    });
  }
});
