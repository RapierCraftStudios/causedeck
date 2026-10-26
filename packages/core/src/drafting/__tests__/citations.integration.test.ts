// Citation checker against Postgres (#77): statuses from the offline mock, idempotent reruns, a new
// version without statuses, the acknowledgement and export gate with its audit row, an outage and
// the daily budget as `unknown`, and no draft text in logs or rows.
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMockResolver } from '@causedeck/drafting';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceError } from '../../shared/errors.ts';
import {
  acknowledgeUnverified,
  checkDraft,
  createDraft,
  exportDraft,
  getCitationReport,
  saveVersion,
} from '../index.ts';

const SECRET_TEXT = 'Privileged fact 7f3a about the client.';
const TEXT = `${SECRET_TEXT} In Ramesh Kumar v. State of Kerala, 2023 INSC 123 the court held; see also 2099 INSC 999 and 2024:KHC:5678.`;
const content = (text: string) => [{ type: 'paragraph', id: 'p1', text }];
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
        name: 'Citation template',
        kind: 'notice',
        courtPreset: 'madras_hc',
        blocks: content('Template body'),
      })
      .returning({ id: schema.template.id }),
  );
  const actor = { workspaceId, userId: seeded.ua };
  const created = await createDraft({ db: tx, now }, actor, {
    templateId: tpl?.id ?? '',
    title: 'Notice',
  });
  const version = await saveVersion({ db: tx }, actor, {
    draftId: created.draft.id,
    content: content(TEXT),
  });
  const logs: unknown[] = [];
  const sink = (...a: unknown[]) => logs.push(a);
  const log = { info: sink, debug: sink };
  return { seeded, actor, created, version, workspaceId, logs, log };
}

describe('citation checker', () => {
  it('labels verified, not_found and unknown; reruns are idempotent; no draft text is kept', async () => {
    await withTestDb(async (tx) => {
      const { actor, version, workspaceId, logs, log } = await setup(tx);
      const deps = { db: tx, resolver: createMockResolver(), now, log };
      const report = await checkDraft(deps, actor, version.id);
      expect(report.counts).toEqual({ verified: 1, not_found: 1, unknown: 1 });
      expect(report.items.map((i) => [i.normalized, i.status, i.reason])).toEqual([
        ['2023 INSC 123', 'verified', undefined],
        ['2099 INSC 999', 'not_found', undefined],
        ['2024:KHC:5678', 'unknown', 'title_missing'],
      ]);
      const again = await checkDraft(deps, actor, version.id);
      expect(again.items.map((i) => i.id)).toEqual(report.items.map((i) => i.id));
      const rows = await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.authority));
      expect(rows).toHaveLength(3);
      expect(JSON.stringify(rows)).not.toContain('7f3a');
      expect(JSON.stringify(logs)).not.toContain('7f3a');
      expect(
        (await getCitationReport({ db: tx }, actor, { draftVersionId: version.id })).counts,
      ).toEqual(report.counts);
    });
  });

  it('gives a new version no statuses until it is checked', async () => {
    await withTestDb(async (tx) => {
      const { actor, version, created } = await setup(tx);
      await checkDraft({ db: tx, now }, actor, version.id);
      const enqueueCitationCheck = vi.fn(() => Promise.resolve(undefined));
      const next = await saveVersion({ db: tx, enqueueCitationCheck }, actor, {
        draftId: created.draft.id,
        content: content(TEXT),
      });
      expect(enqueueCitationCheck).toHaveBeenCalledWith({
        workspaceId: actor.workspaceId,
        draftVersionId: next.id,
      });
      const fresh = await getCitationReport({ db: tx }, actor, { draftVersionId: next.id });
      expect(fresh.items).toEqual([]);
    });
  });

  it('requires an acknowledgement of a not_found citation before the export, and audits it', async () => {
    await withTestDb(async (tx) => {
      const { actor, version, created, workspaceId } = await setup(tx);
      const enqueue = vi.fn(() => Promise.resolve(undefined));
      const input = { draftId: created.draft.id, format: 'docx' as const };
      await expect(exportDraft({ db: tx, enqueue, now }, actor, input)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(enqueue).not.toHaveBeenCalled();

      const report = await getCitationReport({ db: tx }, actor, { draftVersionId: version.id });
      const missing = report.items.find((i) => i.status === 'not_found');
      await expect(
        acknowledgeUnverified({ db: tx, now }, actor, {
          draftVersionId: version.id,
          citationIds: [missing?.id ?? ''],
          reason: 'x',
        }),
      ).rejects.toBeInstanceOf(WorkspaceError);
      await acknowledgeUnverified({ db: tx, now }, actor, {
        draftVersionId: version.id,
        citationIds: [missing?.id ?? ''],
        reason: 'Authority is unreported; cited from the paper book',
      });
      await expect(exportDraft({ db: tx, enqueue }, actor, input)).resolves.toMatchObject({
        status: 'queued',
      });

      const audit = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.workspaceId, workspaceId),
              eq(schema.auditEvent.action, 'draft.citations.acknowledged'),
            ),
          ),
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actorUserId).toBe(actor.userId);
      expect(audit[0]?.metadata).toMatchObject({
        reason: 'Authority is unreported; cited from the paper book',
        citationIds: missing?.id,
      });
      const [row] = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.authority)
          .where(eq(schema.authority.id, missing?.id ?? '')),
      );
      expect(row?.ackBy).toBe(actor.userId);
      expect(row?.ackAt).toEqual(now());
    });
  });

  it('leaves citations unknown while the resolver is unavailable, then resolves them', async () => {
    await withTestDb(async (tx) => {
      const { actor, version } = await setup(tx);
      const down = await checkDraft(
        { db: tx, now, resolver: createMockResolver([], { unavailable: true }) },
        actor,
        version.id,
      );
      expect(down.counts).toEqual({ verified: 0, not_found: 0, unknown: 3 });
      expect(down.items.every((i) => i.reason === 'resolver_unavailable')).toBe(true);
      const up = await checkDraft(
        { db: tx, now, resolver: createMockResolver() },
        actor,
        version.id,
      );
      expect(up.counts.verified).toBe(1);
    });
  });

  it('reports citations past the daily budget as throttled unknowns', async () => {
    await withTestDb(async (tx) => {
      const { actor, version } = await setup(tx);
      const resolver = { ...createMockResolver(), external: true };
      const report = await checkDraft({ db: tx, now, resolver, dailyBudget: 1 }, actor, version.id);
      expect(report.throttled).toBe(2);
      expect(report.counts.unknown).toBe(2);
      expect(report.items.filter((i) => i.reason === 'throttled')).toHaveLength(2);
      const rerun = await checkDraft({ db: tx, now, resolver, dailyBudget: 1 }, actor, version.id);
      expect(rerun.throttled).toBe(2);
    });
  });
});
