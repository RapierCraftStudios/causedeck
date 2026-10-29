// Fact-check service against Postgres (#914): an unverified citation blocks the export (CONFLICT),
// ignore and assertion are matter-scoped and record who, the audited acknowledgement clears the gate,
// and no draft text reaches the stored rows or the audit trail.
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMockResolver } from '@causedeck/drafting';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceError } from '../../shared/errors.ts';
import {
  acknowledgeFactCheck,
  checkFactsLive,
  createDraft,
  exportDraft,
  ignoreForMatter,
  markAsAssertion,
  runFactCheck,
  saveVersion,
} from '../index.ts';

const SECRET_TEXT = 'Privileged fact 7f3a about the client.';
const TEXT = `${SECRET_TEXT} The court held in 2099 INSC 999 that the notice stands.`;
const content = (text: string) => [{ type: 'paragraph', id: 'p1', text }];

async function setup(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const seeded = await seedTwoTenants(tx);
  const workspaceId = seeded.a.id;
  const proceedingId = seeded.a.rows.order?.proceedingId ?? '';
  const [proc] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ matterId: schema.proceeding.matterId })
      .from(schema.proceeding)
      .where(eq(schema.proceeding.id, proceedingId)),
  );
  const matterId = proc?.matterId ?? '';
  const [tpl] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.template)
      .values({
        workspaceId,
        code: `it.${randomUUID().slice(0, 8)}`,
        name: 'Fact template',
        kind: 'notice',
        courtPreset: 'madras_hc',
        blocks: content('Template body'),
      })
      .returning({ id: schema.template.id }),
  );
  const actor = { workspaceId, userId: seeded.ua };
  const created = await createDraft({ db: tx }, actor, {
    templateId: tpl?.id ?? '',
    matterId,
    title: 'Fact draft',
  });
  const version = await saveVersion({ db: tx }, actor, {
    draftId: created.draft.id,
    content: content(TEXT),
  });
  const deps = { db: tx, resolver: createMockResolver() };
  return { seeded, actor, created, version, matterId, workspaceId, deps };
}

describe('fact-check service', () => {
  it('live check reports verdicts with offsets for unsaved text and writes nothing', async () => {
    await withTestDb(async (tx) => {
      const { actor, matterId, workspaceId, deps } = await setup(tx);
      const result = await checkFactsLive(deps, actor, {
        matterId,
        blocks: [{ key: 'b1', text: TEXT }],
      });
      const bad = result.verdicts.find((v) => v.status === 'unverified-citation');
      expect(bad?.blockKey).toBe('b1');
      expect(TEXT.slice(bad?.start, bad?.end)).toContain('INSC');
      expect(result.deep).toBe(false);
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.draftFactAck).where(eq(schema.draftFactAck.matterId, matterId)),
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('blocks the export on an unverified citation until an audited acknowledgement', async () => {
    await withTestDb(async (tx) => {
      const { actor, version, created, workspaceId, deps } = await setup(tx);
      const result = await runFactCheck(deps, actor, { draftVersionId: version.id });
      const open = result.verdicts.filter((v) => v.status === 'unverified-citation');
      expect(open.length).toBeGreaterThan(0);
      expect(result.unresolved).toBe(open.length);

      const enqueue = vi.fn(() => Promise.resolve(undefined));
      const input = { draftId: created.draft.id, versionId: version.id, format: 'docx' as const };
      await expect(
        exportDraft({ db: tx, enqueue, resolver: createMockResolver() } as never, actor, input),
      ).rejects.toBeInstanceOf(WorkspaceError);
      expect(enqueue).not.toHaveBeenCalled();

      await expect(
        acknowledgeFactCheck({ db: tx }, actor, {
          draftVersionId: version.id,
          reason: 'x',
          confirm: false,
        }),
      ).rejects.toBeInstanceOf(WorkspaceError);
      const ack = await acknowledgeFactCheck({ db: tx }, actor, {
        draftVersionId: version.id,
        reason: 'Cited from the paper book',
        confirm: true,
      });
      expect(ack.unresolved).toBe(open.length);
      expect((await runFactCheck(deps, actor, { draftVersionId: version.id })).acknowledged).toBe(
        true,
      );

      const audit = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.workspaceId, workspaceId),
              eq(schema.auditEvent.action, 'draft.factcheck.acknowledged'),
            ),
          ),
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actorUserId).toBe(actor.userId);
      expect(JSON.stringify(audit)).not.toContain('7f3a');
    });
  });

  it('ignore and assertion are matter-scoped, record who, and clear the finding', async () => {
    await withTestDb(async (tx) => {
      const { actor, version, matterId, workspaceId, deps } = await setup(tx);
      const first = await runFactCheck(deps, actor, { draftVersionId: version.id });
      const claimKeys = first.verdicts
        .filter((v) => v.status === 'unverified-citation')
        .map((v) => v.claimKey);
      const [key, ...rest] = claimKeys;
      await ignoreForMatter(deps, actor, { draftVersionId: version.id, claimKey: key ?? '' });
      for (const k of rest) {
        await markAsAssertion(deps, actor, { draftVersionId: version.id, claimKey: k });
      }
      await expect(
        ignoreForMatter(deps, actor, { draftVersionId: version.id, claimKey: 'date:1999-01-01' }),
      ).rejects.toBeInstanceOf(WorkspaceError);
      const after = await runFactCheck(deps, actor, { draftVersionId: version.id });
      expect(after.unresolved).toBe(0);
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.draftFactAck).where(eq(schema.draftFactAck.matterId, matterId)),
      );
      expect(rows.length).toBe(claimKeys.length);
      expect(rows.every((r) => r.userId === actor.userId)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain('7f3a');
    });
  });

  it("keeps another workspace out: B cannot check A's version", async () => {
    await withTestDb(async (tx) => {
      const { seeded, version, workspaceId } = await setup(tx);
      await expect(
        runFactCheck(
          { db: tx, resolver: createMockResolver() },
          { workspaceId, userId: seeded.ub },
          {
            draftVersionId: version.id,
          },
        ),
      ).rejects.toBeInstanceOf(WorkspaceError);
    });
  });
});
