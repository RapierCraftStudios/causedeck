// Propose and confirm (#72): R1 proposals never become items unconfirmed, R2 layers and fields,
// R6 M6 people, R7 repeated edits, R8 correction aliases, R13 no judge or bench, R14 pause-all.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { schema } from '@causedeck/db';
import { inWorkspace } from '@causedeck/db/testing';
import { MemoryLayer } from '@causedeck/validators';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  confirmMemory,
  createMemoryNote,
  dismissMemoryProposal,
  editMemory,
  getMemory,
  listMemory,
  memoryFor,
  proposeFromCorrection,
  proposeFromEdit,
  proposeMemory,
  recordUsage,
  setMemoryPauseAll,
} from '../index.ts';

import {
  codeOf,
  DAY_MS,
  inWorld,
  messageOf,
  T0,
  type World,
} from '../../__tests__/memory-world.ts';

const items = (w: World) => inWorkspace(w.tx, w.a.id, (s) => s.select().from(schema.memoryItem));
const proposals = (w: World) =>
  inWorkspace(w.tx, w.a.id, (s) => s.select().from(schema.memoryProposal));

const edit = (pattern = 'carry vakalat copy') => ({
  outputId: randomUUID(),
  pattern,
  key: 'M2.always_carry',
});

describe('R1: confirm before save', () => {
  it('a proposal writes memory_proposal only; confirmMemory is what creates the item', async () => {
    await inWorld(async (w) => {
      const itemsBefore = (await items(w)).length;
      const proposalsBefore = (await proposals(w)).length;
      const proposal = await proposeMemory(w.deps, w.owner, {
        key: 'M2.brief_format',
        value: 'one page, headnote first',
        scope: 'user',
      });
      expect(proposal?.status).toBe('proposed');
      expect((await items(w)).length).toBe(itemsBefore);
      expect((await proposals(w)).length).toBe(proposalsBefore + 1);

      const item = await confirmMemory(w.deps, w.owner, proposal?.id ?? '');
      expect(item).toMatchObject({
        key: 'M2.brief_format',
        value: 'one page, headnote first',
        status: 'active',
        confirmationState: 'confirmed',
      });
      expect((await items(w)).length).toBe(itemsBefore + 1);
      const [row] = await proposals(w).then((rows) => rows.filter((r) => r.id === proposal?.id));
      expect(row?.status).toBe('confirmed');
      expect(row?.decidedAt).not.toBeNull();
    });
  });

  it('only the proposal owner can confirm, and a proposal confirms once', async () => {
    await inWorld(async (w) => {
      const proposal = await proposeMemory(w.deps, w.owner, {
        key: 'M2.client_update_tone',
        value: 'formal',
        scope: 'user',
      });
      const id = proposal?.id ?? '';
      expect(await codeOf(confirmMemory(w.deps, w.advocate, id))).toBe('NOT_FOUND');
      expect(await codeOf(confirmMemory(w.deps, w.asClerk, id))).toBe('FORBIDDEN');
      await confirmMemory(w.deps, w.owner, id);
      expect(await codeOf(confirmMemory(w.deps, w.owner, id))).toBe('NOT_FOUND');
    });
  });

  it('a correction made while confirming saves the corrected value', async () => {
    await inWorld(async (w) => {
      const proposal = await proposeMemory(w.deps, w.owner, {
        key: 'M2.client_update_tone',
        value: 'casual',
        scope: 'user',
      });
      const item = await confirmMemory(w.deps, w.owner, proposal?.id ?? '', { value: 'formal' });
      expect(item).toMatchObject({ value: 'formal', confirmationState: 'corrected' });
    });
  });

  it('a dismissed proposal can no longer be confirmed', async () => {
    await inWorld(async (w) => {
      const proposal = await proposeMemory(w.deps, w.owner, {
        key: 'M2.brief_format',
        value: 'long form',
        scope: 'user',
      });
      await dismissMemoryProposal(w.deps, w.owner, proposal?.id ?? '');
      expect(await codeOf(confirmMemory(w.deps, w.owner, proposal?.id ?? ''))).toBe('NOT_FOUND');
    });
  });

  it('no code path inserts a memory_item except confirmMemory and a lawyer-authored note', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.includes('__tests__') && !/\.test\.ts$/.test(f))
      .map((f) => ({ file: f.replaceAll('\\', '/'), text: readFileSync(`${root}${f}`, 'utf8') }));
    const writers = files.filter(({ text }) =>
      /\.insert\((?:schema\.)?memoryItem\)|insert\s+into\s+memory_item\b/i.test(text),
    );
    // `completeMemoryReview` (#73) writes the review date, a bookkeeping row that is never a card.
    expect(writers.map((f) => f.file)).toEqual(['memory/confirm.ts', 'memory/review.ts']);
    const confirm = writers.find((f) => f.file === 'memory/confirm.ts');
    expect((confirm?.text.match(/\.insert\(memoryItem\)/g) ?? []).length).toBe(2);
  });
});

describe('R2: layers, keys and fields', () => {
  it('rejects a layer outside M1 to M7', async () => {
    expect(MemoryLayer.safeParse('M5').success).toBe(true);
    expect(MemoryLayer.safeParse('M8').success).toBe(false);
    await inWorld(async (w) => {
      for (const key of ['M5.not_registered', 'M2.not_registered', 'brief_format']) {
        expect(
          await codeOf(proposeMemory(w.deps, w.owner, { key, value: 'x', scope: 'user' })),
        ).toBe('VALIDATION');
      }
    });
  });

  it('keeps each layer to its scopes', async () => {
    await inWorld(async (w) => {
      const bad = [
        { key: 'M3.synopsis', value: 'x', scope: 'user' },
        { key: 'M3.synopsis', value: 'x', scope: 'matter' },
        { key: 'M2.brief_format', value: 'x', scope: 'matter', matterId: w.m1 },
        { key: 'M4.hall_note', value: 'x', scope: 'workspace' },
        { key: 'M2.brief_format', value: 'x', scope: 'user', matterId: w.m1 },
      ];
      for (const input of bad) {
        expect(await codeOf(createMemoryNote(w.deps, w.owner, input)), JSON.stringify(input)).toBe(
          'VALIDATION',
        );
      }
      expect(await codeOf(proposeMemory(w.deps, w.owner, bad[0]))).toBe('VALIDATION');
    });
  });

  it('stores layer, key, value, scope, source, confidence, confirmation state and status', async () => {
    await inWorld(async (w) => {
      const proposal = await proposeMemory(w.deps, w.owner, {
        key: 'M2.always_carry',
        value: ['vakalat copy', 'index'],
        scope: 'user',
        sourceType: 'ai',
        sourceRef: 'doc-1',
        confidence: 0.75,
      });
      const item = await confirmMemory(w.deps, w.owner, proposal?.id ?? '');
      expect(item).toMatchObject({
        layer: 'M2',
        key: 'M2.always_carry',
        value: ['vakalat copy', 'index'],
        scope: 'user',
        sourceType: 'ai',
        sourceRef: 'doc-1',
        confidence: 0.75,
        confirmationState: 'confirmed',
        status: 'active',
      });
      const note = await createMemoryNote(w.deps, w.owner, {
        key: 'M1.courts',
        value: ['Madras High Court'],
        scope: 'workspace',
      });
      expect(note).toMatchObject({ sourceType: 'manual', layer: 'M1', status: 'active' });
    });
  });

  it('does not let a viewer, a clerk or a non-member write memory', async () => {
    await inWorld(async (w) => {
      const input = { key: 'M2.brief_format', value: 'x', scope: 'user' };
      expect(await codeOf(createMemoryNote(w.deps, w.asViewer, input))).toBe('FORBIDDEN');
      expect(await codeOf(createMemoryNote(w.deps, w.asClerk, input))).toBe('FORBIDDEN');
      expect(
        await codeOf(createMemoryNote(w.deps, { userId: w.ub, workspaceId: w.a.id }, input)),
      ).toBe('NOT_FOUND');
    });
  });
});

describe('R6: M6 relationship memory', () => {
  it('accepts a client or a professional contact and rejects any other person', async () => {
    await inWorld(async (w) => {
      const base = { key: 'M6.client_language', value: 'Tamil', scope: 'user' as const };
      expect(
        (await proposeMemory(w.deps, w.owner, { ...base, personId: w.client }))?.personId,
      ).toBe(w.client);
      expect(
        (await proposeMemory(w.deps, w.owner, { ...base, personId: w.professional }))?.personId,
      ).toBe(w.professional);
      expect(await codeOf(proposeMemory(w.deps, w.owner, { ...base, personId: w.party }))).toBe(
        'VALIDATION',
      );
      expect(await codeOf(createMemoryNote(w.deps, w.owner, { ...base, personId: w.party }))).toBe(
        'VALIDATION',
      );
      // No person at all, and a person that does not exist in the workspace.
      expect(await codeOf(proposeMemory(w.deps, w.owner, base))).toBe('VALIDATION');
      expect(
        await codeOf(proposeMemory(w.deps, w.owner, { ...base, personId: randomUUID() })),
      ).toBe('NOT_FOUND');
      // A person of another workspace is not found either.
      const bPerson = await inWorkspace(w.tx, w.b.id, async (s) => {
        const [row] = await s.select({ id: schema.person.id }).from(schema.person);
        return row?.id ?? '';
      });
      expect(await codeOf(proposeMemory(w.deps, w.owner, { ...base, personId: bPerson }))).toBe(
        'NOT_FOUND',
      );
    });
  });
});

describe('R7: repeated edits become one proposal', () => {
  it('turns the same edit in 3 distinct outputs into a single proposal with evidence', async () => {
    await inWorld(async (w) => {
      const first = edit();
      expect(await proposeFromEdit(w.deps, w.owner, first)).toBeNull();
      // The same output again does not count twice.
      expect(await proposeFromEdit(w.deps, w.owner, first)).toBeNull();
      expect(await proposeFromEdit(w.deps, w.owner, edit())).toBeNull();
      const proposal = await proposeFromEdit(w.deps, w.owner, edit());
      expect(proposal).toMatchObject({
        status: 'proposed',
        key: 'M2.always_carry',
        proposedValue: 'carry vakalat copy',
      });
      expect(proposal?.evidence).toMatchObject({ count: 3 });
      expect(String(proposal?.evidence['prompt'])).toContain('carry vakalat copy');
      // A fourth output does not file a second proposal.
      expect(await proposeFromEdit(w.deps, w.owner, edit())).toBeNull();
      const rows = (await proposals(w)).filter(
        (r) => r.patternKey !== null && r.sourceType === 'edit',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('proposed');
    });
  });

  it('does not count a different edit, or another member, toward the pattern', async () => {
    await inWorld(async (w) => {
      await proposeFromEdit(w.deps, w.owner, edit());
      await proposeFromEdit(w.deps, w.owner, edit('attach index'));
      expect(await proposeFromEdit(w.deps, w.advocate, edit())).toBeNull();
      expect(await proposeFromEdit(w.deps, w.owner, edit())).toBeNull();
    });
  });

  it('does not re-propose a dismissed pattern for 60 days', async () => {
    await inWorld(async (w) => {
      const at = (offsetDays: number) => w.at(new Date(T0.getTime() + offsetDays * DAY_MS));
      await proposeFromEdit(at(0), w.owner, edit());
      await proposeFromEdit(at(0), w.owner, edit());
      const proposal = await proposeFromEdit(at(0), w.owner, edit());
      await dismissMemoryProposal(at(0), w.owner, proposal?.id ?? '');
      // Inside the window: three more outputs propose nothing.
      for (let i = 0; i < 3; i++) expect(await proposeFromEdit(at(59), w.owner, edit())).toBeNull();
      expect(
        (await proposals(w)).filter((r) => r.status === 'proposed' && r.sourceType === 'edit'),
      ).toHaveLength(0);
      // After 60 days the pattern is counted afresh and proposes again.
      expect(await proposeFromEdit(at(61), w.owner, edit())).toBeNull();
      expect(await proposeFromEdit(at(61), w.owner, edit())).toBeNull();
      expect((await proposeFromEdit(at(61), w.owner, edit()))?.status).toBe('proposed');
    });
  });
});

describe('R8: correction aliases', () => {
  it('proposes an M7 alias and dedupes against pending proposals and saved aliases', async () => {
    await inWorld(async (w) => {
      const correction = { alias: 'Rajan', canonical: 'M. Rajan s/o Murugan' };
      const proposal = await proposeFromCorrection(w.deps, w.owner, correction);
      expect(proposal).toMatchObject({
        layer: 'M7',
        key: 'M7.party_alias',
        proposedValue: { alias: 'Rajan', canonical: 'M. Rajan s/o Murugan' },
      });
      // Pending already.
      expect(await proposeFromCorrection(w.deps, w.owner, correction)).toBeNull();
      await confirmMemory(w.deps, w.owner, proposal?.id ?? '');
      // Saved already, whatever the case and spacing.
      expect(
        await proposeFromCorrection(w.deps, w.owner, {
          alias: ' rajan ',
          canonical: 'm.  rajan s/o murugan',
        }),
      ).toBeNull();
      // A different canonical name is a new alias; a matter alias uses its own key.
      expect(
        await proposeFromCorrection(w.deps, w.owner, { alias: 'Rajan', canonical: 'R. Rajan' }),
      ).not.toBeNull();
      const matterAlias = await proposeFromCorrection(w.deps, w.owner, {
        alias: 'Rajan case',
        canonical: 'Rajan v. State',
        target: 'matter',
      });
      expect(matterAlias?.key).toBe('M7.matter_alias');
    });
  });
});

describe('R13: no judge or bench', () => {
  const JUDGE = 'Justice Kumar dislikes adjournments';

  it('rejects a judge or bench value everywhere a value enters, with a clear error', async () => {
    await inWorld(async (w) => {
      const input = { key: 'M2.brief_format', value: JUDGE, scope: 'user' };
      expect(await messageOf(proposeMemory(w.deps, w.owner, input))).toMatch(/judge or a bench/);
      expect(await codeOf(proposeMemory(w.deps, w.owner, input))).toBe('VALIDATION');
      expect(await codeOf(createMemoryNote(w.deps, w.owner, input))).toBe('VALIDATION');
      expect(await codeOf(proposeFromEdit(w.deps, w.owner, edit('judge likes short briefs')))).toBe(
        'VALIDATION',
      );
      expect(
        await codeOf(
          proposeFromCorrection(w.deps, w.owner, { alias: 'KK', canonical: "Hon'ble Justice K" }),
        ),
      ).toBe('VALIDATION');
      const ok = await createMemoryNote(w.deps, w.owner, {
        key: 'M2.brief_format',
        value: 'one page',
        scope: 'user',
      });
      expect(await codeOf(editMemory(w.deps, w.owner, ok.id, { value: JUDGE }))).toBe('VALIDATION');
      expect(
        await codeOf(proposeMemory(w.deps, w.owner, { ...input, key: 'M2.judge_style' })),
      ).toBe('VALIDATION');
      const pending = await proposeMemory(w.deps, w.owner, {
        key: 'M2.brief_format',
        value: 'ok',
        scope: 'user',
      });
      expect(
        await codeOf(confirmMemory(w.deps, w.owner, pending?.id ?? '', { value: JUDGE })),
      ).toBe('VALIDATION');
    });
  });
});

describe('R14: pause all memory', () => {
  it('stops proposals, reads, usage and confirmation at once, for that member only', async () => {
    await inWorld(async (w) => {
      const saved = await createMemoryNote(w.deps, w.owner, {
        key: 'M2.brief_format',
        value: 'one page',
        scope: 'user',
      });
      const pending = await proposeMemory(w.deps, w.owner, {
        key: 'M2.client_update_tone',
        value: 'formal',
        scope: 'user',
      });
      expect(
        (await memoryFor(w.deps, w.owner, { layers: ['M2'], purpose: 'brief' })).items.map(
          (i) => i.id,
        ),
      ).toContain(saved.id);

      await setMemoryPauseAll(w.deps, w.owner, true);
      const before = (await proposals(w)).length;
      expect(
        await proposeMemory(w.deps, w.owner, { key: 'M2.brief_format', value: 'x', scope: 'user' }),
      ).toBeNull();
      expect(await proposeFromEdit(w.deps, w.owner, edit())).toBeNull();
      expect(
        await proposeFromCorrection(w.deps, w.owner, { alias: 'A', canonical: 'B C' }),
      ).toBeNull();
      expect((await proposals(w)).length).toBe(before);
      expect(await memoryFor(w.deps, w.owner, { layers: ['M2'], purpose: 'brief' })).toEqual({
        items: [],
        citations: [],
      });
      expect(await recordUsage(w.deps, w.owner, { itemId: saved.id, usedIn: 'brief' })).toBe(false);
      expect(await codeOf(confirmMemory(w.deps, w.owner, pending?.id ?? ''))).toBe('CONFLICT');
      // The lawyer's own management still works while paused.
      expect((await getMemory(w.deps, w.owner, saved.id)).item.id).toBe(saved.id);
      expect((await listMemory(w.deps, w.owner)).map((i) => i.id)).toContain(saved.id);

      // Another member is unaffected.
      expect(
        (
          await proposeMemory(w.deps, w.advocate, {
            key: 'M2.brief_format',
            value: 'y',
            scope: 'user',
          })
        )?.status,
      ).toBe('proposed');

      await setMemoryPauseAll(w.deps, w.owner, false);
      expect(
        (await memoryFor(w.deps, w.owner, { layers: ['M2'], purpose: 'brief' })).items.map(
          (i) => i.id,
        ),
      ).toContain(saved.id);
      const rows = await inWorkspace(w.tx, w.a.id, (s) =>
        s.select().from(schema.memoryPause).where(eq(schema.memoryPause.userId, w.ua)),
      );
      expect(rows).toHaveLength(0);
    });
  });
});
