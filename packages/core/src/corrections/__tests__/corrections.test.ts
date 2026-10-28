// A0 grid corrections (#558) on the test database: the DB-backed store, tenancy (workspace B can
// neither read nor write A's corrections or cite A's documents), consent off by default, the
// owner-only `allow_eval_reuse` switch with its ids-only audit, and the two-part eval gate.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildDocument } from '@causedeck/db/testing/matter-graph-fixtures';
import type { A0Correction } from '@causedeck/intelligence';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember, failure, newWorkspace } from '../../__tests__/fixtures.ts';
import { getAllowEvalReuse, setAllowEvalReuse, WorkspaceError } from '../../workspaces/index.ts';
import {
  createCorrectionStore,
  listDocumentCorrections,
  listForEvalExport,
  setCorrectionEvalConsent,
} from '../index.ts';

const sample = (documentId: string, over: Partial<A0Correction> = {}): A0Correction => ({
  documentId,
  forumCode: 'generic.a0',
  rowKey: 'cnr:TNCH010012342026',
  column: 'stageText',
  before: 'FOR ADMISSION',
  after: 'FOR ORDERS',
  page: 1,
  quote: 'FOR ADMISSION',
  ...over,
});

async function world(tx: Transaction) {
  const a = await newWorkspace(tx);
  const b = await newWorkspace(tx);
  const docA = await inWorkspace(tx, a.workspaceId, (s) => buildDocument(s, a.workspaceId));
  const store = (w: { workspaceId: string; ownerId: string }) =>
    createCorrectionStore({ db: tx, workspaceId: w.workspaceId, actorUserId: w.ownerId });
  return { a, b, docA, store };
}

describe('corrections store', () => {
  it('saves corrections linked to the document, in the workspace only', async () => {
    await withTestDb(async (tx) => {
      const { a, docA, store } = await world(tx);
      await inWorkspace(tx, a.workspaceId, async (s) => {
        await createCorrectionStore({
          db: s,
          workspaceId: a.workspaceId,
          actorUserId: a.ownerId,
        }).save([sample(docA.id)]);
        const rows = await listDocumentCorrections(s, a.workspaceId, docA.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          after: 'FOR ORDERS',
          column: 'stageText',
          evalConsent: false,
        });
      });
      expect(store).toBeTypeOf('function');
    });
  });

  it("workspace B cannot read A's corrections", async () => {
    await withTestDb(async (tx) => {
      const { a, b, docA } = await world(tx);
      await inWorkspace(tx, a.workspaceId, (s) =>
        createCorrectionStore({ db: s, workspaceId: a.workspaceId, actorUserId: a.ownerId }).save([
          sample(docA.id),
        ]),
      );
      const seenByB = await inWorkspace(tx, b.workspaceId, async (s) => ({
        all: await s.select().from(schema.correction),
        byDoc: await listDocumentCorrections(s, b.workspaceId, docA.id),
        // Asking for A's workspace id from B's scope still returns nothing (RLS).
        spoofed: await listDocumentCorrections(s, a.workspaceId, docA.id),
        exportable: await listForEvalExport(s, a.workspaceId),
      }));
      expect(seenByB.all).toEqual([]);
      expect(seenByB.byDoc).toEqual([]);
      expect(seenByB.spoofed).toEqual([]);
      expect(seenByB.exportable).toEqual([]);
    });
  });

  it("workspace B cannot write into A's workspace or cite A's document", async () => {
    await withTestDb(async (tx) => {
      const { a, b, docA } = await world(tx);
      // A row for A's workspace id from B's scope violates the RLS check.
      await expect(
        failure(
          inWorkspace(tx, b.workspaceId, (s) =>
            createCorrectionStore({
              db: s,
              workspaceId: a.workspaceId,
              actorUserId: b.ownerId,
            }).save([sample(docA.id)]),
          ),
        ),
      ).resolves.toBeDefined();
      // B's own row cannot cite A's document (composite FK).
      await expect(
        failure(
          inWorkspace(tx, b.workspaceId, (s) =>
            createCorrectionStore({
              db: s,
              workspaceId: b.workspaceId,
              actorUserId: b.ownerId,
            }).save([sample(docA.id)]),
          ),
        ),
      ).resolves.toBeDefined();
      const rows = await inWorkspace(tx, a.workspaceId, (s) => s.select().from(schema.correction));
      expect(rows).toEqual([]);
    });
  });
});

describe('eval reuse consent', () => {
  it('is off by default, with and without a settings row', async () => {
    await withTestDb(async (tx) => {
      const { a } = await world(tx);
      expect(await inWorkspace(tx, a.workspaceId, (s) => getAllowEvalReuse(s, a.workspaceId))).toBe(
        false,
      );
      const [row] = await inWorkspace(tx, a.workspaceId, (s) =>
        s
          .select({ v: schema.workspaceSettings.allowEvalReuse })
          .from(schema.workspaceSettings)
          .where(eq(schema.workspaceSettings.workspaceId, a.workspaceId)),
      );
      expect(row?.v ?? false).toBe(false);
    });
  });

  it('can be set by the owner only', async () => {
    await withTestDb(async (tx) => {
      const { a } = await world(tx);
      for (const role of ['advocate', 'junior', 'clerk', 'viewer'] as const) {
        const userId = await addMember(tx, a.workspaceId, role);
        const error = await failure(
          inWorkspace(tx, a.workspaceId, (s) =>
            setAllowEvalReuse(s, { workspaceId: a.workspaceId, actorUserId: userId, allow: true }),
          ),
        );
        expect(error).toBeInstanceOf(WorkspaceError);
        expect((error as WorkspaceError).code).toBe('FORBIDDEN');
      }
      expect(await inWorkspace(tx, a.workspaceId, (s) => getAllowEvalReuse(s, a.workspaceId))).toBe(
        false,
      );
      const result = await inWorkspace(tx, a.workspaceId, (s) =>
        setAllowEvalReuse(s, { workspaceId: a.workspaceId, actorUserId: a.ownerId, allow: true }),
      );
      expect(result).toEqual({ allowEvalReuse: true, changed: true });
      expect(await inWorkspace(tx, a.workspaceId, (s) => getAllowEvalReuse(s, a.workspaceId))).toBe(
        true,
      );
    });
  });

  it('audits changes with ids only and records nothing for a no-op', async () => {
    await withTestDb(async (tx) => {
      const { a } = await world(tx);
      const set = (allow: boolean) =>
        inWorkspace(tx, a.workspaceId, (s) =>
          setAllowEvalReuse(s, { workspaceId: a.workspaceId, actorUserId: a.ownerId, allow }),
        );
      await set(false);
      await set(true);
      await set(true);
      await set(false);
      const events = await inWorkspace(tx, a.workspaceId, (s) =>
        s
          .select({
            action: schema.auditEvent.action,
            targetId: schema.auditEvent.targetId,
            metadata: schema.auditEvent.metadata,
            actorUserId: schema.auditEvent.actorUserId,
          })
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.workspaceId, a.workspaceId)),
      );
      const mine = events.filter((e) => e.action.startsWith('workspace.eval_reuse_'));
      expect(mine.map((e) => e.action).sort()).toEqual([
        'workspace.eval_reuse_disabled',
        'workspace.eval_reuse_enabled',
      ]);
      for (const e of mine) {
        expect(e.targetId).toBe(a.workspaceId);
        expect(e.actorUserId).toBe(a.ownerId);
        expect(e.metadata).toEqual({});
      }
    });
  });

  it('exports only when the workspace opt-in and the item consent both hold', async () => {
    await withTestDb(async (tx) => {
      const { a, docA } = await world(tx);
      const run = <T>(fn: (s: Transaction) => Promise<T>) => inWorkspace(tx, a.workspaceId, fn);
      await run((s) =>
        createCorrectionStore({ db: s, workspaceId: a.workspaceId, actorUserId: a.ownerId }).save([
          sample(docA.id),
          sample(docA.id, { column: 'parties', after: 'A v B', before: null }),
        ]),
      );
      const rows = await run((s) => listDocumentCorrections(s, a.workspaceId, docA.id));
      const ids = rows.map((r) => r.id);
      const consent = (consentValue: boolean, correctionIds: string[]) =>
        run((s) =>
          setCorrectionEvalConsent(s, {
            workspaceId: a.workspaceId,
            actorUserId: a.ownerId,
            correctionIds,
            consent: consentValue,
          }),
        );
      const owner = (allow: boolean) =>
        run((s) =>
          setAllowEvalReuse(s, { workspaceId: a.workspaceId, actorUserId: a.ownerId, allow }),
        );

      // Default: nothing exports, and item consent cannot be granted without the opt-in.
      expect(await run((s) => listForEvalExport(s, a.workspaceId))).toEqual([]);
      await expect(consent(true, ids)).rejects.toThrow(/not allowed/);

      await owner(true);
      // Opt-in alone exports nothing: per-item consent is still required.
      expect(await run((s) => listForEvalExport(s, a.workspaceId))).toEqual([]);
      await consent(true, [ids[0] as string]);
      const exported = await run((s) => listForEvalExport(s, a.workspaceId));
      expect(exported.map((c) => c.id)).toEqual([ids[0]]);

      // Turning the opt-in off empties the export and withdraws the item consents.
      await owner(false);
      expect(await run((s) => listForEvalExport(s, a.workspaceId))).toEqual([]);
      const left = await run((s) =>
        s
          .select({ id: schema.correction.id })
          .from(schema.correction)
          .where(
            and(
              eq(schema.correction.workspaceId, a.workspaceId),
              eq(schema.correction.evalConsent, true),
            ),
          ),
      );
      expect(left).toEqual([]);
    });
  });
});
