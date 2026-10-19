// `ai_call` guardrails (#226, #26; PRD TR-3): automation levels 1-4 only, so an L5 (fully
// autonomous) record cannot be stored, and the TR-3 audit fields are present.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { aiCall } from '../schema/audit.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { sqlState } from './rls/fixtures.ts';

const row = (workspaceId: string, automationLevel: number) => ({
  workspaceId,
  purpose: 'test.extract',
  provider: 'mock',
  model: 'mock-1',
  region: 'ap-south-1',
  sources: [{ documentId: randomUUID(), anchor: 'p1' }],
  confidence: '0.875',
  automationLevel,
});

describe('ai_call', () => {
  it.each([0, 5, 6])('rejects automation_level %i with the CHECK', async (level) => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await inWorkspace(tx, workspaceId, async (scoped) => {
        const insert = scoped.transaction((sp) =>
          sp.insert(aiCall).values(row(workspaceId, level)),
        );
        const error: unknown = await insert.then(
          () => undefined,
          (e: unknown) => e,
        );
        const cause = ((error as { cause?: unknown }).cause ?? error) as {
          code?: string;
          constraint_name?: string;
        };
        expect(cause.code).toBe('23514');
        expect(cause.constraint_name).toBe('ai_call_automation_level_chk');
      });
    });
  });

  it('accepts automation levels 1 to 4', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await inWorkspace(tx, workspaceId, async (scoped) => {
        for (const level of [1, 2, 3, 4]) {
          expect(
            await sqlState(
              scoped.transaction((sp) => sp.insert(aiCall).values(row(workspaceId, level))),
            ),
          ).toBeUndefined();
        }
        const stored = await scoped.select({ level: aiCall.automationLevel }).from(aiCall);
        expect(stored.map((r) => r.level).sort()).toEqual([1, 2, 3, 4]);
      });
    });
  });

  it('has the TR-3 audit fields', async () => {
    await withTestDb(async (tx) => {
      const columns = await tx.execute<{ name: string }>(sql`
        select column_name as name from information_schema.columns
        where table_schema = 'public' and table_name = 'ai_call'`);
      expect(columns.map((c) => c.name)).toEqual(
        expect.arrayContaining([
          'model',
          'region',
          'sources',
          'confidence',
          'user_action',
          'automation_level',
          'auto_applied',
          'undone_at',
        ]),
      );
    });
  });
});
