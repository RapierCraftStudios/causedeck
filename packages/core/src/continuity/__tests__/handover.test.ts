import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { NONE_RECORDED } from '@causedeck/validators';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember } from '../../__tests__/fixtures.ts';
import {
  acknowledgeHandover,
  generateHandover,
  generateHandoversForMember,
  listHandovers,
  saveHandover,
} from '../index.ts';

import { memberIdOf, seedContinuity } from './helpers.ts';

describe('generateHandover (R1, R3)', () => {
  it('assembles the sections, every line with provenance, in under 3 s', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture } = await seedContinuity(tx);
      const started = performance.now();
      const body = await generateHandover(deps, actor, fixture.matterId);
      expect(performance.now() - started).toBeLessThan(3000);
      expect(body.stages).toHaveLength(1);
      expect(body.last_orders).toHaveLength(1);
      const lines = body.last_orders[0]?.lines ?? [];
      expect(lines).toHaveLength(2);
      for (const l of lines) {
        expect(l.page_no).toBe(1);
        expect(l.anchor_id).not.toBeNull();
      }
      expect(body.open_obligations.map((o) => o.text).join()).toMatch(/counter not yet filed/);
      expect(body.open_obligations[0]?.overdue).toBe(true);
      expect(body.coming_up).toHaveLength(1);
      expect(body.key_documents.length).toBeGreaterThan(0);
      for (const l of [...body.stages.map((s) => s.line), ...body.key_documents]) {
        expect(l.source_type).toBeTruthy();
      }
      expect(body.open_questions).toEqual([]);
      expect(body.open_questions_label).toBe(NONE_RECORDED);
    });
  });

  it('writes nothing but an access audit event', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture, workspaceId } = await seedContinuity(tx);
      await generateHandover(deps, actor, fixture.matterId);
      expect(await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.handoverNote))).toEqual([]);
    });
  });
});

describe('saveHandover and acknowledgeHandover (R2, R3)', () => {
  it('stores immutable numbered versions addressed to a member; only the recipient acknowledges', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture, workspaceId, ownerMemberId } = await seedContinuity(tx);
      const recipientUser = await addMember(tx, workspaceId, 'advocate');
      const recipient = await memberIdOf(tx, workspaceId, recipientUser);
      const first = await saveHandover(deps, actor, {
        matterId: fixture.matterId,
        recipientMemberId: recipient,
        edits: { where_it_stands: 'Counter due' },
        openQuestions: ['Is the limitation point live?'],
      });
      expect(first.version).toBe(1);
      expect(first.author_id).toBe(ownerMemberId);
      expect(first.recipient_id).toBe(recipient);
      expect(first.acknowledged_at).toBeNull();
      expect(first.body.edits.where_it_stands).toBe('Counter due');
      expect(first.body.derived.open_questions[0]?.text).toBe('Is the limitation point live?');
      expect(first.body.derived.open_questions_label).toBeNull();
      // The saved question carries into the next generated note.
      expect((await generateHandover(deps, actor, fixture.matterId)).open_questions).toHaveLength(1);
      const second = await saveHandover(deps, actor, {
        matterId: fixture.matterId,
        recipientMemberId: recipient,
      });
      expect(second.version).toBe(2);
      const asRecipient = { userId: recipientUser, workspaceId };
      const seen = await listHandovers(deps, asRecipient, { matterId: fixture.matterId });
      expect(seen.map((n) => n.version)).toEqual([2, 1]);
      await expect(acknowledgeHandover(deps, actor, { handoverId: first.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      const acked = await acknowledgeHandover(deps, asRecipient, { handoverId: first.id });
      expect(acked.acknowledged_at).toBe(deps.now().toISOString());
      const again = await acknowledgeHandover(
        { ...deps, now: () => new Date('2026-11-01T00:00:00Z') },
        asRecipient,
        { handoverId: first.id },
      );
      expect(again.acknowledged_at).toBe(acked.acknowledged_at);
      // A version row is immutable: its body is not rewritten by later saves.
      const [row] = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.handoverNote).where(eq(schema.handoverNote.id, first.id)),
      );
      expect(JSON.stringify(row?.body)).toMatch(/Counter due/);
    });
  });

  it('refuses a viewer, an invalid input and a non-member recipient', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, fixture, workspaceId, ownerMemberId } = await seedContinuity(tx);
      const viewer = await addMember(tx, workspaceId, 'viewer');
      await expect(
        saveHandover(deps, { userId: viewer, workspaceId }, {
          matterId: fixture.matterId,
          recipientMemberId: ownerMemberId,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(saveHandover(deps, actor, { matterId: 'x' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(
        saveHandover(deps, actor, {
          matterId: fixture.matterId,
          recipientMemberId: '00000000-0000-4000-8000-0000000000aa',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });
});

describe('generateHandoversForMember (R10)', () => {
  it('writes a note per active matter the leaving member owns, addressed to the successor', async () => {
    await withTestDb(async (tx) => {
      const { deps, actor, workspaceId, ownerMemberId, fixture } = await seedContinuity(tx);
      const successorUser = await addMember(tx, workspaceId, 'advocate');
      const successor = await memberIdOf(tx, workspaceId, successorUser);
      const notes = await generateHandoversForMember(deps, actor, {
        fromMemberId: ownerMemberId,
        toMemberId: successor,
      });
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((n) => n.recipient_id === successor)).toBe(true);
      expect(notes.map((n) => n.matter_id)).toContain(fixture.matterId);
    });
  });
});
