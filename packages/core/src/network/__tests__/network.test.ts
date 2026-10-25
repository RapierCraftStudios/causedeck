// The court document network (#485) against a real Postgres: nothing is contributed without the
// opt-in, sensitive or restricted matters and non-public kinds never are, a text is stored once,
// another workspace reads it without any contributor field, and withdrawal blanks it.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createWorkspace } from '../../workspaces/index.ts';
import {
  checkEligibility,
  contributeDocument,
  ContributionRefused,
  findContributed,
  withdrawContributions,
} from '../index.ts';

const TEXT = 'Court Hall 3 cause list: item 1 State v. Doe';

async function workspace(tx: Transaction, optIn = true) {
  const [u] = await tx
    .insert(schema.user)
    .values({ name: 'Owner', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!u) throw new Error('user insert failed');
  const ws = await createWorkspace(tx, {
    userId: u.id,
    input: { name: `Net ${randomUUID().slice(0, 8)}` },
  });
  if (optIn) {
    await inWorkspace(tx, ws.id, (s) =>
      s
        .insert(schema.workspaceSettings)
        .values({ workspaceId: ws.id, contributePublicCourtDocuments: true })
        .onConflictDoUpdate({
          target: schema.workspaceSettings.workspaceId,
          set: { contributePublicCourtDocuments: true },
        }),
    );
  }
  return { id: ws.id, userId: u.id };
}

async function clearedSource(tx: Transaction, over: { killSwitch?: boolean } = {}) {
  const id = `net.${randomUUID().replaceAll('-', '')}`;
  await tx.insert(schema.source).values({
    id,
    kind: 'court',
    baseUrl: `urn:net:${id}`,
    owner: 'net',
    termsStatus: 'cleared',
    counselStatus: 'cleared',
    clearedAt: new Date(),
    retentionDays: 10,
    ...over,
  });
  return id;
}

async function doc(
  tx: Transaction,
  workspaceId: string,
  opts: {
    kind?: 'cause_list' | 'order' | 'note';
    sensitive?: boolean;
    restrict?: boolean;
    text?: string;
  } = {},
) {
  let matterId: string | null = null;
  if (opts.sensitive !== undefined) {
    const [m] = await inWorkspace(tx, workspaceId, (s) =>
      s
        .insert(schema.matter)
        .values({ workspaceId, title: 'Secret v. State', sensitive: opts.sensitive })
        .returning({ id: schema.matter.id }),
    );
    matterId = m?.id ?? null;
    if (opts.restrict && matterId)
      await inWorkspace(tx, workspaceId, (s) =>
        s.insert(schema.matterRestriction).values({ workspaceId, matterId: matterId as string }),
      );
  }
  const id = randomUUID();
  await inWorkspace(tx, workspaceId, async (s) => {
    await s.insert(schema.document).values({
      id,
      workspaceId,
      matterId,
      kind: (opts.kind ?? 'cause_list') as never,
      storageKey: `ws/${workspaceId}/document/${id}`,
      sha256: 'a'.repeat(64),
      textStatus: 'layer',
    });
    await s
      .insert(schema.documentPage)
      .values({ workspaceId, documentId: id, pageNo: 1, text: opts.text ?? TEXT });
  });
  return id;
}

const ledger = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) => s.select().from(schema.contributionLedger));

describe('court document network', () => {
  it('contributes nothing unless the workspace opted in', async () => {
    await withTestDb(async (tx) => {
      const a = await workspace(tx, false);
      const sourceId = await clearedSource(tx);
      const documentId = await doc(tx, a.id);
      expect(await checkEligibility(tx, { workspaceId: a.id, documentId, sourceId })).toBe(
        'not_opted_in',
      );
      await expect(
        contributeDocument(tx, { workspaceId: a.id, documentId, sourceId }),
      ).rejects.toMatchObject({ reason: 'not_opted_in' });
      expect(await ledger(tx, a.id)).toEqual([]);
    });
  });

  it('never contributes sensitive or restricted matters, or non-public kinds', async () => {
    await withTestDb(async (tx) => {
      const a = await workspace(tx);
      const sourceId = await clearedSource(tx);
      const cases = [
        [await doc(tx, a.id, { sensitive: true }), 'sensitive_matter'],
        [await doc(tx, a.id, { sensitive: false, restrict: true }), 'restricted_matter'],
        [await doc(tx, a.id, { kind: 'note' }), 'kind_not_public'],
      ] as const;
      for (const [documentId, reason] of cases) {
        await expect(
          contributeDocument(tx, { workspaceId: a.id, documentId, sourceId }),
        ).rejects.toBeInstanceOf(ContributionRefused);
        expect(await checkEligibility(tx, { workspaceId: a.id, documentId, sourceId })).toBe(
          reason,
        );
      }
      expect(await ledger(tx, a.id)).toEqual([]);
    });
  });

  it('refuses an uncleared or killed source', async () => {
    await withTestDb(async (tx) => {
      const a = await workspace(tx);
      const documentId = await doc(tx, a.id);
      const killed = await clearedSource(tx, { killSwitch: true });
      for (const sourceId of [killed, 'net.unknown']) {
        expect(await checkEligibility(tx, { workspaceId: a.id, documentId, sourceId })).toBe(
          'source_not_cleared',
        );
      }
    });
  });

  it('stores once, sets retention from the source, and serves B with no contributor', async () => {
    await withTestDb(async (tx) => {
      const a = await workspace(tx);
      const b = await workspace(tx);
      const sourceId = await clearedSource(tx);
      const first = await contributeDocument(tx, {
        workspaceId: a.id,
        documentId: await doc(tx, a.id),
        sourceId,
        forumLabel: 'High Court',
        actorUserId: a.userId,
      });
      const second = await contributeDocument(tx, {
        workspaceId: b.id,
        documentId: await doc(tx, b.id),
        sourceId,
      });
      expect(first.created).toBe(true);
      expect(second).toEqual({
        contributedDocumentId: first.contributedDocumentId,
        created: false,
      });

      const [row] = await tx
        .select()
        .from(schema.contributedDocument)
        .where(eq(schema.contributedDocument.id, first.contributedDocumentId));
      expect(row?.provenance).toBe('contributed');
      expect(row?.content).toBe(TEXT);
      const days = ((row?.retentionUntil.getTime() ?? 0) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(9);
      expect(days).toBeLessThanOrEqual(10);
      // Content and public provenance only: no workspace, matter or document identifiers.
      expect(Object.keys(row ?? {}).sort()).toEqual(
        [
          'contributedAt',
          'content',
          'forumLabel',
          'id',
          'kind',
          'listingDate',
          'provenance',
          'retentionUntil',
          'sha256',
          'sourceId',
          'withdrawnAt',
        ].sort(),
      );

      const copies = await findContributed(tx, { sourceId, kind: 'cause_list' });
      expect(copies).toHaveLength(1);
      expect(copies[0]?.content).toBe(TEXT);
      const serialised = JSON.stringify(copies);
      expect(serialised).not.toContain(a.id);
      expect(serialised).not.toContain(b.id);
    });
  });

  it('withdraws: a copy others still stand behind stays, the last withdrawal blanks it', async () => {
    await withTestDb(async (tx) => {
      const a = await workspace(tx);
      const b = await workspace(tx);
      const sourceId = await clearedSource(tx);
      for (const w of [a, b])
        await contributeDocument(tx, {
          workspaceId: w.id,
          documentId: await doc(tx, w.id),
          sourceId,
        });

      expect(await withdrawContributions(tx, a.id)).toBe(0);
      expect(await ledger(tx, a.id)).toEqual([]);
      expect(await findContributed(tx, { sourceId, kind: 'cause_list' })).toHaveLength(1);

      expect(await withdrawContributions(tx, b.id)).toBe(1);
      expect(await findContributed(tx, { sourceId, kind: 'cause_list' })).toEqual([]);
      const [row] = await tx
        .select()
        .from(schema.contributedDocument)
        .where(eq(schema.contributedDocument.sourceId, sourceId));
      expect(row?.content).toBeNull();
      expect(row?.withdrawnAt).not.toBeNull();
    });
  });
});
