// Section from facts (#1143, 2/3 of #1118) against Postgres: narrative facts come from the
// matter-graph under the actor's access, a sensitive matter makes no model call, and a playbook
// applies only the prayers (and annexure order) the lawyer confirmed.
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { factsForPrompt, type NarrativePort } from '@causedeck/drafting';
import type { Playbook } from '@causedeck/validators';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../../shared/errors.ts';
import { createDraft, renderDraft } from '../index.ts';
import { loadDraftFacts } from '../service.ts';

const now = () => new Date('2026-05-01T06:00:00Z');
const MATTER_TITLE = 'Vellore v. Roads 1143';
const PRAYERS = ['Issue a writ of mandamus', 'Grant costs', 'Any other relief'];

const templateBlocks = [
  { type: 'narrative', id: 'n1', prompt: 'Summarise the facts', maxChars: 400 },
  {
    type: 'section',
    id: 'prayer',
    children: [{ type: 'paragraph', text: 'old prayer' }],
  },
  {
    type: 'section',
    id: 'annexures',
    children: [
      { type: 'paragraph', text: 'Annexure B' },
      { type: 'paragraph', text: 'Annexure A' },
    ],
  },
];

const playbook: Playbook = {
  name: 'Writ',
  courtId: null,
  format: 'writ_petition',
  standardPrayers: PRAYERS,
  annexureOrder: ['Annexure A', 'Annexure B'],
};

function recordingPort() {
  const calls: { taskId: string; input: unknown; ctx: { matterId?: string } }[] = [];
  const port: NarrativePort = {
    run(taskId, input, ctx) {
      calls.push({ taskId, input, ctx });
      return Promise.resolve({ output: { text: 'The client filed on the stated date.' } });
    },
  };
  return { port, calls };
}

async function setup(tx: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const seeded = await seedTwoTenants(tx);
  const workspaceId = seeded.a.id;
  const actor = { workspaceId, userId: seeded.ua };
  const [m] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.matter)
      .values({ workspaceId, title: MATTER_TITLE, practiceArea: 'civil' })
      .returning({ id: schema.matter.id }),
  );
  const matterId = m?.id ?? '';
  const [tpl] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.template)
      .values({
        workspaceId,
        code: `sff.${randomUUID().slice(0, 8)}`,
        name: 'Section from facts',
        kind: 'petition',
        courtPreset: 'madras_hc',
        blocks: templateBlocks,
      })
      .returning({ id: schema.template.id }),
  );
  const created = await createDraft({ db: tx, now }, actor, {
    templateId: tpl?.id ?? '',
    matterId,
    title: 'Writ petition',
  });
  return { seeded, actor, workspaceId, matterId, draftId: created.draft.id };
}

const sectionTexts = (blocks: readonly unknown[], id: string): string[] => {
  const sec = blocks.find((b) => (b as { id?: string }).id === id) as
    { children: { type: string; text?: string; children?: { text: string }[] }[] } | undefined;
  const first = sec?.children[0];
  if (first?.type === 'list') return (first.children ?? []).map((c) => c.text);
  return (sec?.children ?? []).map((c) => c.text ?? '');
};

describe('section from facts', () => {
  it('sends the matter-graph facts of the actor to the narrative port', async () => {
    await withTestDb(async (tx) => {
      const { actor, matterId, draftId } = await setup(tx);
      const { port, calls } = recordingPort();
      const rendered = await renderDraft({ db: tx, now, narrativePort: port }, actor, { draftId });
      const facts = await loadDraftFacts({ db: tx, now }, actor, matterId);
      expect(facts.matter?.title).toBe(MATTER_TITLE);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.taskId).toBe('draft_narrative');
      expect((calls[0]?.input as { facts: unknown }).facts).toEqual(factsForPrompt(facts));
      expect(calls[0]?.ctx.matterId).toBe(matterId);
      expect(rendered.aiBlocked).toBe(false);
      expect(Object.keys(rendered.narratives)).toEqual(['n1']);
    });
  });

  it('denies a member without access to a restricted matter and never calls the port', async () => {
    await withTestDb(async (tx) => {
      const { seeded, workspaceId, matterId, draftId } = await setup(tx);
      await inWorkspace(tx, workspaceId, (s) =>
        s.insert(schema.matterRestriction).values({
          workspaceId,
          matterId,
          allowedUserIds: [seeded.ua],
          createdBy: seeded.ua,
        }),
      );
      const { port, calls } = recordingPort();
      await expect(
        renderDraft(
          { db: tx, now, narrativePort: port },
          { workspaceId, userId: seeded.uboth },
          {
            draftId,
          },
        ),
      ).rejects.toBeInstanceOf(WorkspaceError);
      expect(calls).toHaveLength(0);
    });
  });

  it('makes no model call for a sensitive matter', async () => {
    await withTestDb(async (tx) => {
      const { actor, workspaceId, matterId, draftId } = await setup(tx);
      await inWorkspace(tx, workspaceId, (s) =>
        s
          .update(schema.matter)
          .set({ sensitive: true })
          .where(and(eq(schema.matter.workspaceId, workspaceId), eq(schema.matter.id, matterId))),
      );
      const { port, calls } = recordingPort();
      const rendered = await renderDraft({ db: tx, now, narrativePort: port }, actor, { draftId });
      expect(calls).toHaveLength(0);
      expect(rendered.narratives).toEqual({});
      expect(rendered.aiBlocked).toBe(true);
    });
  });

  it('applies only the prayers the lawyer confirmed', async () => {
    await withTestDb(async (tx) => {
      const { actor, draftId } = await setup(tx);
      const render = (confirmedPrayers: string[], confirmAnnexureOrder?: boolean) =>
        renderDraft({ db: tx, now }, actor, {
          draftId,
          playbook: {
            playbook,
            confirmedPrayers,
            ...(confirmAnnexureOrder === undefined ? {} : { confirmAnnexureOrder }),
          },
        });
      const one = await render([PRAYERS[1] ?? '']);
      expect(sectionTexts(one.blocks, 'prayer')).toEqual(['Grant costs']);
      const ignored = await render([PRAYERS[1] ?? '', 'Not in the playbook']);
      expect(sectionTexts(ignored.blocks, 'prayer')).toEqual(['Grant costs']);
      const none = await render([]);
      expect(sectionTexts(none.blocks, 'prayer')).toEqual(['old prayer']);
    });
  });

  it('reorders annexures only when the order is confirmed', async () => {
    await withTestDb(async (tx) => {
      const { actor, draftId } = await setup(tx);
      const render = (confirmAnnexureOrder?: boolean) =>
        renderDraft({ db: tx, now }, actor, {
          draftId,
          playbook: {
            playbook,
            confirmedPrayers: [],
            ...(confirmAnnexureOrder === undefined ? {} : { confirmAnnexureOrder }),
          },
        });
      expect(sectionTexts((await render()).blocks, 'annexures')).toEqual([
        'Annexure B',
        'Annexure A',
      ]);
      expect(sectionTexts((await render(true)).blocks, 'annexures')).toEqual([
        'Annexure A',
        'Annexure B',
      ]);
    });
  });

  it('leaves the stored blocks as they are without a playbook', async () => {
    await withTestDb(async (tx) => {
      const { actor, draftId } = await setup(tx);
      const rendered = await renderDraft({ db: tx, now }, actor, { draftId });
      expect(rendered.blocks).toEqual(templateBlocks);
    });
  });
});
