// M5 precedent bank and playbooks (#901, ADR 0046): a passage is saved only through a confirmed
// proposal, provenance is stored, a dismissed passage rests 30 days, a clerk is denied, sharing is
// the owner's switch, and deleting a passage removes its vectors.
import { createHash, randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  confirmPlaybook,
  confirmPrecedentProposal,
  deletePrecedent,
  dismissPrecedentProposal,
  listPlaybooks,
  listPrecedents,
  proposePlaybook,
  proposePrecedent,
  purgeDeletedMemoryEmbeddings,
  searchPrecedents,
  setM5Shared,
  type MemoryEmbedder,
} from '../index.ts';

import { codeOf, DAY_MS, inWorld, T0, type World } from '../../__tests__/memory-world.ts';

const PASSAGE = 'It is therefore prayed that this Hon’ble Court may issue a writ of mandamus.';

async function exportedDraft(w: World, text = PASSAGE) {
  return inWorkspace(w.tx, w.a.id, async (s) => {
    const [tpl] = await s
      .insert(schema.template)
      .values({
        workspaceId: w.a.id,
        code: `m5.${randomUUID().slice(0, 8)}`,
        name: 'T',
        kind: 'petition',
        courtPreset: 'generic',
      })
      .returning({ id: schema.template.id });
    const [draft] = await s
      .insert(schema.draft)
      .values({ workspaceId: w.a.id, templateId: tpl?.id ?? '', title: 'Writ' })
      .returning({ id: schema.draft.id });
    const content = [{ type: 'paragraph', id: 'b1', text }];
    const [version] = await s
      .insert(schema.draftVersion)
      .values({
        workspaceId: w.a.id,
        draftId: draft?.id ?? '',
        versionNo: 1,
        content,
        contentSha256: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
        createdBy: w.owner.userId,
      })
      .returning({ id: schema.draftVersion.id });
    await s.insert(schema.draftExport).values({
      workspaceId: w.a.id,
      draftVersionId: version?.id ?? '',
      format: 'docx',
      storageKey: `ws/${w.a.id}/export/${randomUUID()}`,
      sizeBytes: 1,
      contentSha256: createHash('sha256').update(text).digest('hex'),
    });
    return version?.id ?? '';
  });
}

const input = (draftVersionId: string, passageText = PASSAGE) => ({
  passageText,
  kind: 'prayer',
  courtId: null,
  sourceAnchor: { draftVersionId, anchorId: 'b1' },
  confidence: 0.9,
});

async function saved(w: World) {
  const versionId = await exportedDraft(w);
  const proposal = await proposePrecedent(w.deps, w.owner, input(versionId));
  const out = await confirmPrecedentProposal(w.deps, w.owner, proposal?.id ?? '');
  return { versionId, proposalId: proposal?.id ?? '', ...out };
}

const rows = <T>(
  w: World,
  f: (s: Parameters<Parameters<typeof inWorkspace>[2]>[0]) => Promise<T>,
) => inWorkspace(w.tx, w.a.id, f);

describe('M5 precedent bank', () => {
  it('a proposal writes no item or passage; confirming saves both with provenance and a vector', async () => {
    await inWorld(async (w) => {
      const versionId = await exportedDraft(w);
      const proposal = await proposePrecedent(w.deps, w.owner, input(versionId));
      expect(proposal?.status).toBe('proposed');
      expect(await rows(w, (s) => s.select().from(schema.precedentPassage))).toHaveLength(0);
      expect(
        await rows(w, (s) =>
          s.select().from(schema.memoryItem).where(eq(schema.memoryItem.layer, 'M5')),
        ),
      ).toHaveLength(0);

      const { passageId, item } = await confirmPrecedentProposal(
        w.deps,
        w.owner,
        proposal?.id ?? '',
      );
      const [passage] = await rows(w, (s) => s.select().from(schema.precedentPassage));
      expect(passage).toMatchObject({
        id: passageId,
        memoryItemId: item.id,
        sourceDraftVersionId: versionId,
        anchorId: 'b1',
        kind: 'prayer',
        status: 'active',
      });
      expect(passage?.bodyCiphertext).not.toContain('mandamus');
      expect(await rows(w, (s) => s.select().from(schema.memoryEmbedding))).toHaveLength(1);
    });
  });

  it('refuses a draft that is not the actor’s, not exported, or lacks the passage', async () => {
    await inWorld(async (w) => {
      const versionId = await exportedDraft(w);
      expect(await codeOf(proposePrecedent(w.deps, w.advocate, input(versionId)))).toBe(
        'FORBIDDEN',
      );
      expect(await codeOf(proposePrecedent(w.deps, w.owner, input(randomUUID())))).toBe(
        'NOT_FOUND',
      );
      expect(
        await codeOf(proposePrecedent(w.deps, w.owner, input(versionId, 'A different passage.'))),
      ).toBe('VALIDATION');
    });
  });

  it('a dismissed passage rests 30 days with a reason code, then may be proposed again', async () => {
    await inWorld(async (w) => {
      const versionId = await exportedDraft(w);
      const first = await proposePrecedent(w.at(T0), w.owner, input(versionId));
      expect(await proposePrecedent(w.at(T0), w.owner, input(versionId))).toBeNull();
      await dismissPrecedentProposal(w.at(T0), w.owner, first?.id ?? '', 'too_specific');
      const [row] = await rows(w, (s) =>
        s
          .select()
          .from(schema.memoryProposal)
          .where(eq(schema.memoryProposal.id, first?.id ?? '')),
      );
      expect(row?.evidence['dismissReason']).toBe('too_specific');
      expect(
        await proposePrecedent(
          w.at(new Date(T0.getTime() + 29 * DAY_MS)),
          w.owner,
          input(versionId),
        ),
      ).toBeNull();
      expect(
        await proposePrecedent(
          w.at(new Date(T0.getTime() + 31 * DAY_MS)),
          w.owner,
          input(versionId),
        ),
      ).not.toBeNull();
      expect(await codeOf(dismissPrecedentProposal(w.deps, w.owner, randomUUID(), 'other'))).toBe(
        'NOT_FOUND',
      );
    });
  });

  it('search is scoped: own passages, chamber-shared only when the owner shared, no clerk', async () => {
    await inWorld(async (w) => {
      const { item } = await saved(w);
      const hits = await searchPrecedents(w.deps, w.owner, 'writ of mandamus prayer');
      expect(hits.map((h) => h.itemId)).toEqual([item.id]);
      expect(hits[0]?.text).toBe(PASSAGE);

      expect(await searchPrecedents(w.deps, w.advocate, 'writ of mandamus')).toEqual([]);
      expect(await codeOf(searchPrecedents(w.deps, w.asClerk, 'writ'))).toBe('FORBIDDEN');
      expect(await codeOf(listPrecedents(w.deps, w.asViewer))).toBe('FORBIDDEN');

      // Only an owner shares, and only their own item; then a chamber member finds it.
      expect(await codeOf(setM5Shared(w.deps, w.advocate, item.id, true))).toBeDefined();
      await setM5Shared(w.deps, w.owner, item.id, true);
      expect(
        (await searchPrecedents(w.deps, w.advocate, 'writ of mandamus')).map((h) => h.itemId),
      ).toEqual([item.id]);
      await setM5Shared(w.deps, w.owner, item.id, false);
      expect(await searchPrecedents(w.deps, w.advocate, 'writ of mandamus')).toEqual([]);
    });
  });

  it('workspace B never sees workspace A passages', async () => {
    await inWorld(async (w) => {
      await saved(w);
      expect(await searchPrecedents(w.deps, w.ownerB, 'writ of mandamus')).toEqual([]);
      expect(await listPrecedents(w.deps, w.ownerB)).toEqual([]);
    });
  });

  it('delete removes the text at once and its vectors with the purge sweep', async () => {
    await inWorld(async (w) => {
      const { item } = await saved(w);
      await deletePrecedent(w.deps, w.owner, item.id);
      expect(await searchPrecedents(w.deps, w.owner, 'writ of mandamus')).toEqual([]);
      const [passage] = await rows(w, (s) => s.select().from(schema.precedentPassage));
      expect(passage).toMatchObject({ status: 'deleted', bodyCiphertext: null });
      // The sweep is the 24 h backstop; the delete already removed the vectors.
      await purgeDeletedMemoryEmbeddings(w.tx, w.a.id);
      expect(await rows(w, (s) => s.select().from(schema.memoryEmbedding))).toHaveLength(0);
    });
  });

  it('a non-India embedder is refused and audited, and nothing is saved', async () => {
    await inWorld(async (w) => {
      const versionId = await exportedDraft(w);
      const proposal = await proposePrecedent(w.deps, w.owner, input(versionId));
      const foreign: MemoryEmbedder = {
        region: 'other',
        id: 'us-embedder',
        embed: () => Promise.reject(new Error('must not be called')),
      };
      expect(
        await codeOf(
          confirmPrecedentProposal({ ...w.deps, embedder: foreign }, w.owner, proposal?.id ?? ''),
        ),
      ).toBe('FORBIDDEN');
      const audit = await rows(w, (s) =>
        s
          .select()
          .from(schema.auditEvent)
          .where(
            and(
              eq(schema.auditEvent.workspaceId, w.a.id),
              eq(schema.auditEvent.action, 'memory.embedding_refused'),
            ),
          ),
      );
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0]?.metadata)).not.toContain('mandamus');
      expect(await rows(w, (s) => s.select().from(schema.precedentPassage))).toHaveLength(0);
    });
  });
});

describe('M5 playbooks', () => {
  const playbook = {
    name: 'Writ petition, Madras HC',
    courtId: null,
    format: 'writ_petition',
    standardPrayers: ['issue a writ of mandamus'],
    annexureOrder: ['Annexure P-1'],
  };

  it('is saved only on confirmation and an update replaces the earlier version', async () => {
    await inWorld(async (w) => {
      const first = await proposePlaybook(w.deps, w.owner, playbook);
      expect(await listPlaybooks(w.deps, w.owner)).toEqual([]);
      await confirmPlaybook(w.deps, w.owner, first?.id ?? '');
      const second = await proposePlaybook(w.deps, w.owner, {
        ...playbook,
        standardPrayers: ['issue a writ of certiorari'],
      });
      await confirmPlaybook(w.deps, w.owner, second?.id ?? '');
      const list = await listPlaybooks(w.deps, w.owner);
      expect(list).toHaveLength(1);
      expect(list[0]?.standardPrayers).toEqual(['issue a writ of certiorari']);
      expect(await codeOf(listPlaybooks(w.deps, w.asClerk))).toBe('FORBIDDEN');
    });
  });
});
