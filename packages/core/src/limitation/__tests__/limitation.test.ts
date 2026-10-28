// The limitation services (#940) on the test database: flag gating, rule loading (drafts), the
// reviewed-rule requirement, compute and confirm with provenance, roles and cross-tenant refusals.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildMatter } from '@causedeck/db/testing/matter-graph-fixtures';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember, newWorkspace } from '../../__tests__/fixtures.ts';
import { createObligation } from '../../obligations/index.ts';
import {
  computeLimitation,
  confirmLimitation,
  LimitationDisabledError,
  listLimitations,
  listRules,
  loadRuleTable,
  NoReviewedRuleError,
  type LimitationDeps,
} from '../index.ts';
import table from '../__fixtures__/synthetic-rules.json' with { type: 'json' };

const deps = (tx: Transaction, over: Partial<LimitationDeps> = {}): LimitationDeps => ({
  db: tx,
  flagEnabled: () => Promise.resolve(true),
  now: () => new Date('2026-11-02T10:00:00Z'),
  ...over,
});

async function chamber(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const as = (userId: string) => ({ userId, workspaceId });
  const matter = await inWorkspace(tx, workspaceId, (s) => buildMatter(s, workspaceId));
  return {
    workspaceId,
    matterId: matter.id,
    owner: as(ownerId),
    advocate: as(await addMember(tx, workspaceId, 'advocate')),
    junior: as(await addMember(tx, workspaceId, 'junior')),
    clerk: as(await addMember(tx, workspaceId, 'clerk')),
    viewer: as(await addMember(tx, workspaceId, 'viewer')),
  };
}

/** Counsel's sign-off (#120) is out of scope here: mark the imported drafts reviewed directly. */
async function review(tx: Transaction, workspaceId: string) {
  await inWorkspace(tx, workspaceId, (s) =>
    s
      .update(schema.limitationRule)
      .set({ reviewed: true, reviewedAt: new Date('2026-10-01T00:00:00Z') })
      .where(eq(schema.limitationRule.workspaceId, workspaceId)),
  );
}

const INPUT = (matterId: string) => ({
  matterId,
  ruleCode: 'synthetic.appeal_order',
  startDate: '2026-01-10',
});

describe('limitation.enabled flag', () => {
  it('refuses every service with LimitationDisabledError while off', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const off = deps(tx, { flagEnabled: () => Promise.resolve(false) });
      const id = '11111111-1111-4111-8111-111111111111';
      for (const call of [
        () => loadRuleTable(off, c.owner, table),
        () => listRules(off, c.owner),
        () => computeLimitation(off, c.owner, INPUT(c.matterId)),
        () => confirmLimitation(off, c.owner, { computationId: id }),
        () => listLimitations(off, c.owner),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(LimitationDisabledError);
      }
    });
  });
});

describe('rules', () => {
  it('imports a table as unreviewed drafts and refuses to compute from them', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      const out = await loadRuleTable(deps(tx), c.owner, table);
      expect(out).toMatchObject({ imported: 3, skipped: 0, draft: true });
      expect((await loadRuleTable(deps(tx), c.owner, table)).skipped).toBe(3);
      const rules = await listRules(deps(tx), c.owner);
      expect(rules).toHaveLength(3);
      expect(rules.every((r) => r.draft && !r.reviewed)).toBe(true);
      await expect(computeLimitation(deps(tx), c.owner, INPUT(c.matterId))).rejects.toBeInstanceOf(
        NoReviewedRuleError,
      );
    });
  });

  it('rejects an invalid table and a non-writer import', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      await expect(loadRuleTable(deps(tx), c.owner, { version: '1', rules: [] })).rejects.toThrow();
      await expect(loadRuleTable(deps(tx), c.junior, table)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});

describe('compute and confirm', () => {
  it('stores a proposal with rule version and inputs, then confirms into a rule obligation', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      await loadRuleTable(deps(tx), c.owner, table);
      await review(tx, c.workspaceId);
      const proposed = await computeLimitation(deps(tx), c.advocate, INPUT(c.matterId));
      expect(proposed).toMatchObject({
        status: 'proposed',
        expiresOn: '2026-02-09',
        ruleVersion: 'synthetic-1',
      });
      const [stored] = await inWorkspace(tx, c.workspaceId, (s) =>
        s.select().from(schema.limitationComputation),
      );
      expect(stored?.input).toMatchObject({ ruleVersion: 'synthetic-1', startDate: '2026-01-10' });
      // Nothing is scheduled until a person confirms.
      expect(await obligationsOf(tx, c)).toEqual([]);

      const done = await confirmLimitation(deps(tx), c.advocate, { computationId: proposed.id });
      const [ob] = await obligationsOf(tx, c);
      expect(ob).toMatchObject({
        id: done.obligationId,
        source: 'rule',
        dueDate: '2026-02-09',
        sourceRef: `limitation rule ${proposed.ruleId ?? ''} vsynthetic-1`,
        confirmationState: 'confirmed',
      });
      await expect(
        confirmLimitation(deps(tx), c.advocate, { computationId: proposed.id }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('keeps the public createObligation refusing a rule source', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      await expect(
        createObligation(deps(tx), c.owner, {
          matterId: c.matterId,
          source: 'rule',
          description: 'x',
          dueDate: '2026-12-01',
          ownerMemberId: '11111111-1111-4111-8111-111111111111',
          provenance: { sourceType: 'system', sourceRef: 'x' },
        }),
      ).rejects.toThrow();
    });
  });
});

describe('roles', () => {
  it('lets owner and advocate compute, a clerk and viewer see due dates only', async () => {
    await withTestDb(async (tx) => {
      const c = await chamber(tx);
      await loadRuleTable(deps(tx), c.owner, table);
      await review(tx, c.workspaceId);
      const first = await computeLimitation(deps(tx), c.owner, INPUT(c.matterId));
      await computeLimitation(deps(tx), c.advocate, INPUT(c.matterId));
      await confirmLimitation(deps(tx), c.owner, { computationId: first.id });
      for (const who of [c.junior, c.clerk, c.viewer]) {
        await expect(computeLimitation(deps(tx), who, INPUT(c.matterId))).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await expect(
          confirmLimitation(deps(tx), who, { computationId: first.id }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      const junior = await listLimitations(deps(tx), c.junior);
      expect(junior).toHaveLength(2);
      expect(junior[0]).toHaveProperty('ruleVersion');
      for (const who of [c.clerk, c.viewer]) {
        const seen = await listLimitations(deps(tx), who);
        expect(seen).toEqual([
          { id: first.id, matterId: c.matterId, expiresOn: '2026-02-09', status: 'confirmed' },
        ]);
        expect(await listRules(deps(tx), who)).toEqual([]);
      }
    });
  });
});

describe('cross-tenant', () => {
  it('refuses B on A, leaving A unchanged and invisible to B', async () => {
    await withTestDb(async (tx) => {
      const a = await chamber(tx);
      const b = await chamber(tx);
      await loadRuleTable(deps(tx), a.owner, table);
      await review(tx, a.workspaceId);
      const proposed = await computeLimitation(deps(tx), a.owner, INPUT(a.matterId));
      const claim = { userId: b.owner.userId, workspaceId: a.workspaceId };
      await expect(computeLimitation(deps(tx), claim, INPUT(a.matterId))).rejects.toThrow();
      await expect(
        confirmLimitation(deps(tx), claim, { computationId: proposed.id }),
      ).rejects.toThrow();
      // B in its own workspace cannot see or confirm A's computation, nor use A's rules.
      await expect(
        confirmLimitation(deps(tx), b.owner, { computationId: proposed.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(computeLimitation(deps(tx), b.owner, INPUT(b.matterId))).rejects.toBeInstanceOf(
        NoReviewedRuleError,
      );
      expect(await listLimitations(deps(tx), b.owner)).toEqual([]);
      expect(await listRules(deps(tx), b.owner)).toEqual([]);
      const own = await listLimitations(deps(tx), a.owner);
      expect(own).toHaveLength(1);
      expect(own[0]?.status).toBe('proposed');
    });
  });
});

async function obligationsOf(tx: Transaction, c: { workspaceId: string; matterId: string }) {
  return inWorkspace(tx, c.workspaceId, (s) =>
    s
      .select()
      .from(schema.obligation)
      .where(
        and(
          eq(schema.obligation.workspaceId, c.workspaceId),
          eq(schema.obligation.matterId, c.matterId),
        ),
      ),
  );
}
