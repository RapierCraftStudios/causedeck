// The ai_call writer contract for the AI gateway (#227 for #44): rows land in their workspace, L5
// cannot be stored, sources hold ids and anchors only, and rows are append-only.
import { randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { AiCallContractError, recordAiCall, type AiCallInput } from '../index.ts';
import { failure, sqlState } from './fixtures.ts';

const input: AiCallInput = {
  purpose: 'brief.draft',
  provider: 'mock',
  model: 'mock-1',
  modelVersion: '2026-10',
  region: 'ap-south-1',
  inputTokens: 1200,
  outputTokens: 300,
  costPaise: 42,
  sources: [{ id: 'doc-1', anchor: 'p4' }, { id: 'doc-2' }],
  confidence: 0.8125,
  automationLevel: 2,
  userAction: 'accepted',
};

describe('recordAiCall', () => {
  it('inserts one row in the workspace with the TR-3 fields', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      const { id } = await recordAiCall(tx, workspaceId, input);
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.aiCall).where(eq(schema.aiCall.id, id)),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workspaceId,
        model: 'mock-1',
        region: 'ap-south-1',
        sources: [{ id: 'doc-1', anchor: 'p4' }, { id: 'doc-2' }],
        confidence: '0.813',
        automationLevel: 2,
        autoApplied: false,
        userAction: 'accepted',
      });
    });
  });

  it('rejects automation level 5, in the writer and in the database', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await expect(
        recordAiCall(tx, workspaceId, { ...input, automationLevel: 5 as never }),
      ).rejects.toBeInstanceOf(AiCallContractError);
      const error = await failure(
        inWorkspace(tx, workspaceId, (s) =>
          s.transaction((sp) =>
            sp.insert(schema.aiCall).values({
              workspaceId,
              purpose: 'x',
              provider: 'mock',
              model: 'mock-1',
              region: 'ap-south-1',
              automationLevel: 5,
            }),
          ),
        ),
      );
      expect(sqlState(error)).toBe('23514');
    });
  });

  it('rejects sources that carry more than ids and anchors', async () => {
    await withTestDb(async (tx) => {
      await expect(
        recordAiCall(tx, randomUUID(), {
          ...input,
          sources: [{ id: 'doc-1', quote: 'the witness stated' } as never],
        }),
      ).rejects.toBeInstanceOf(AiCallContractError);
    });
  });

  it('is append-only for the app role', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      const { id } = await recordAiCall(tx, workspaceId, input);
      const error = await failure(
        inWorkspace(tx, workspaceId, (s) =>
          s.transaction((sp) =>
            sp.execute(sql`update ai_call set user_action = 'undone' where id = ${id}::uuid`),
          ),
        ),
      );
      expect(sqlState(error)).toBe('42501');
    });
  });
});
