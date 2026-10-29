// Drafting service and `drafting.export` against Postgres (#768): immutable versions with a content
// hash, restore as a new version, clerk denial, an idempotent encrypted export that is only reachable
// through a presigned download, the audit event, blocked slots and no draft text in logs.
import { randomBytes, randomUUID } from 'node:crypto';

import { ResidencyViolationError, type Provider } from '@causedeck/ai';
import { Secret } from '@causedeck/config/env';
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { MissingSlotsError } from '@causedeck/drafting';
import type { Logger } from '@causedeck/observability';
import { createMemoryObjectStore, EnvKeyProvider } from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { createCoreAiGateway } from '../../ai/index.ts';
import { WorkspaceError } from '../../shared/errors.ts';
import {
  createDraft,
  createDraftExportDownload,
  exportDraft,
  listVersions,
  renderDraft,
  restoreVersion,
  runDraftingExport,
  saveVersion,
} from '../index.ts';

const SECRET_TEXT = 'Privileged paragraph text 7f3a';
const content = (text: string) => [{ type: 'paragraph', id: 'p1', text }];
const keys = new EnvKeyProvider([{ id: 'kek-1', key: new Secret(randomBytes(32)) }]);
const now = () => new Date('2026-05-01T06:00:00Z');

async function setup(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const seeded = await seedTwoTenants(tx);
  const workspaceId = seeded.a.id;
  const [tpl] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.template)
      .values({
        workspaceId,
        code: `it.${randomUUID().slice(0, 8)}`,
        name: 'Integration template',
        kind: 'notice',
        courtPreset: 'madras_hc',
        blocks: content('Template body'),
      })
      .returning({ id: schema.template.id }),
  );
  // The seeded key row is wrapped by a KEK this test does not hold: start from none.
  await inWorkspace(tx, workspaceId, (s) =>
    s.delete(schema.workspaceKey).where(eq(schema.workspaceKey.workspaceId, workspaceId)),
  );
  const actor = { workspaceId, userId: seeded.ua };
  const created = await createDraft({ db: tx, now }, actor, {
    templateId: tpl?.id ?? '',
    title: 'Notice to opposite party',
  });
  const logs: unknown[] = [];
  const log = {
    info: (...a: unknown[]) => logs.push(a),
    warn: (...a: unknown[]) => logs.push(a),
  } as unknown as Pick<Logger, 'info' | 'warn'>;
  return { seeded, actor, created, logs, log, workspaceId };
}

describe('drafting service and export', () => {
  it('saves immutable hashed versions and restores as a new version', async () => {
    await withTestDb(async (tx) => {
      const { actor, created } = await setup(tx);
      const draftId = created.draft.id;
      expect(created.version.versionNo).toBe(1);
      const v2 = await saveVersion({ db: tx }, actor, { draftId, content: content(SECRET_TEXT) });
      expect(v2.versionNo).toBe(2);
      expect(v2.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(v2.contentSha256).not.toBe(created.version.contentSha256);
      const v3 = await restoreVersion({ db: tx }, actor, { draftId, versionNo: 1 });
      expect(v3.versionNo).toBe(3);
      expect(v3.contentSha256).toBe(created.version.contentSha256);
      const versions = await listVersions({ db: tx }, actor, { draftId });
      expect(versions.map((v) => v.versionNo)).toEqual([3, 2, 1]);
      const rendered = await renderDraft({ db: tx }, actor, { draftId, versionNo: 2 });
      expect(rendered.contentSha256).toBe(v2.contentSha256);
    });
  });

  it('denies a clerk and another workspace', async () => {
    await withTestDb(async (tx) => {
      const { seeded, created, workspaceId } = await setup(tx);
      const clerk = seeded.a.rows.member?.userId ?? '';
      const as = (userId: string, wid = workspaceId) => ({ workspaceId: wid, userId });
      await expect(
        listVersions({ db: tx }, as(seeded.ub), { draftId: created.draft.id }),
      ).rejects.toBeInstanceOf(WorkspaceError);
      await expect(
        saveVersion({ db: tx }, as(clerk), { draftId: created.draft.id, content: [] }),
      ).rejects.toBeInstanceOf(WorkspaceError);
    });
  });

  it('exports once, encrypted, with audit, a presigned download and no draft text in logs', async () => {
    await withTestDb(async (tx) => {
      const { actor, created, logs, log, workspaceId, seeded } = await setup(tx);
      const draftId = created.draft.id;
      const v = await saveVersion({ db: tx }, actor, { draftId, content: content(SECRET_TEXT) });
      const enqueue = vi.fn(() => Promise.resolve(undefined));
      const queued = await exportDraft({ db: tx, enqueue }, actor, { draftId, format: 'docx' });
      expect(queued.status).toBe('queued');
      expect(enqueue).toHaveBeenCalledOnce();

      const store = createMemoryObjectStore();
      const payload = {
        workspaceId,
        draftVersionId: v.id,
        format: 'docx' as const,
        userId: seeded.ua,
      };
      const ctx = { db: tx, store, keys, log, now };
      const first = await runDraftingExport(ctx, payload);
      const again = await runDraftingExport(ctx, payload);
      expect(first.status).toBe('exported');
      expect(again.status).toBe('existing');
      expect(again.export.id).toBe(first.export.id);
      expect(first.export.storageKey.startsWith(`ws/${workspaceId}/export/`)).toBe(true);
      expect(first.export.contentSha256).toBe(v.contentSha256);

      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.draftExport).where(eq(schema.draftExport.draftVersionId, v.id)),
      );
      expect(rows).toHaveLength(1);
      const audit = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.workspaceId, workspaceId),
              eq(schema.auditEvent.action, 'draft.exported'),
            ),
          ),
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.metadata).toMatchObject({
        format: 'docx',
        versionHash: v.contentSha256,
        bannerShown: true,
      });

      const ready = await exportDraft({ db: tx, enqueue }, actor, { draftId, format: 'docx' });
      expect(ready.status).toBe('ready');

      const link = await createDraftExportDownload({ db: tx, store, now }, actor, first.export.id);
      expect(link.url).toContain(first.export.storageKey);
      expect(link.filename.endsWith('-v2.docx')).toBe(true);

      expect(JSON.stringify(logs)).not.toContain(SECRET_TEXT);
    });
  });

  it('records bannerShown false once the template has a reviewer', async () => {
    await withTestDb(async (tx) => {
      const { actor, created, log, workspaceId, seeded } = await setup(tx);
      await inWorkspace(tx, workspaceId, (s) =>
        s.update(schema.template).set({ reviewedBy: 'A. Advocate' }),
      );
      const v = await saveVersion({ db: tx }, actor, {
        draftId: created.draft.id,
        content: content(SECRET_TEXT),
      });
      const payload = {
        workspaceId,
        draftVersionId: v.id,
        format: 'docx' as const,
        userId: seeded.ua,
      };
      await runDraftingExport(
        { db: tx, store: createMemoryObjectStore(), keys, log, now },
        payload,
      );
      const audit = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, 'draft.exported')),
      );
      expect(audit[0]?.metadata).toMatchObject({ bannerShown: false });
    });
  });

  it('denies a clerk on export and on download', async () => {
    await withTestDb(async (tx) => {
      const { seeded, actor, created, workspaceId, log } = await setup(tx);
      const v = await saveVersion({ db: tx }, actor, {
        draftId: created.draft.id,
        content: content('Body'),
      });
      const store = createMemoryObjectStore();
      const done = await runDraftingExport(
        { db: tx, store, keys, log, now },
        { workspaceId, draftVersionId: v.id, format: 'pdf', userId: seeded.ua },
      );
      const clerkId = seeded.a.rows.member?.userId ?? '';
      await tx
        .update(schema.member)
        .set({ role: 'clerk' })
        .where(eq(schema.member.userId, clerkId));
      const clerk = { workspaceId, userId: clerkId };
      await expect(
        exportDraft({ db: tx, enqueue: vi.fn() }, clerk, {
          draftId: created.draft.id,
          format: 'docx',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        createDraftExportDownload({ db: tx, store, now }, clerk, done.export.id),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  it('writes an ai_call row for a refused non-India narrative call', async () => {
    await withTestDb(async (tx) => {
      const { seeded, actor, created, workspaceId, log } = await setup(tx);
      const callSpy = vi.fn(() => Promise.reject(new Error('must not be called')));
      const abroad: Provider = {
        id: 'bedrock',
        region: 'us-east-1',
        dataResidency: 'other',
        supports: ['draft_narrative'],
        modelFor: () => 'm',
        call: callSpy,
      };
      const v = await saveVersion({ db: tx }, actor, {
        draftId: created.draft.id,
        content: [{ type: 'narrative', id: 'n1', prompt: 'Summarise the facts', maxChars: 500 }],
      });
      await expect(
        runDraftingExport(
          {
            db: tx,
            store: createMemoryObjectStore(),
            keys,
            log,
            now,
            narrativePort: createCoreAiGateway(tx, { now, providers: [abroad] }),
          },
          { workspaceId, draftVersionId: v.id, format: 'docx', userId: seeded.ua },
        ),
      ).rejects.toBeInstanceOf(ResidencyViolationError);
      expect(callSpy).not.toHaveBeenCalled();
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.workspaceId, workspaceId)),
      );
      // The seeded workspace already holds an unrelated ai_call row: look at the narrative task only.
      expect(rows.filter((r) => r.task === 'draft_narrative').map((r) => r.status)).toEqual([
        'residency_violation',
      ]);
      const exported = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.draftExport).where(eq(schema.draftExport.draftVersionId, v.id)),
      );
      expect(exported).toEqual([]);
    });
  });

  it('blocks an export with an unresolved slot', async () => {
    await withTestDb(async (tx) => {
      const { actor, created, log, workspaceId, seeded } = await setup(tx);
      const slot = [{ type: 'slot', id: 's1', resolver: 'matter.title' }];
      const v = await saveVersion({ db: tx }, actor, {
        draftId: created.draft.id,
        content: slot,
      });
      await expect(
        runDraftingExport(
          { db: tx, store: createMemoryObjectStore(), keys, log, now },
          { workspaceId, draftVersionId: v.id, format: 'pdf', userId: seeded.ua },
        ),
      ).rejects.toBeInstanceOf(MissingSlotsError);
    });
  });
});
