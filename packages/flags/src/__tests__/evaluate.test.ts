// Precedence: kill switch > workspace override > global row > registry default (#22).
import { withWorkspace } from '@causedeck/db';
import { featureFlag, workspaceFeatureFlag } from '@causedeck/db/schema';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { evaluateAll, isEnabled, resolveFlag, type FlagRow } from '../evaluate.ts';

import { on, seed } from './helpers.ts';

const plain = { default: false, legalGated: false } as const;
const row = (enabled: boolean, legalAckBy: string | null = null): FlagRow => ({
  enabled,
  legalAckBy,
});

describe('resolveFlag (pure precedence)', () => {
  it('registry default when no layer says anything', () => {
    expect(resolveFlag(plain, { killed: false })).toBe(false);
  });

  it('global row over the default', () => {
    expect(resolveFlag(plain, { killed: false, global: row(true) })).toBe(true);
    expect(resolveFlag(plain, { killed: false, global: row(false) })).toBe(false);
  });

  it('workspace override over the global row, in both directions', () => {
    expect(resolveFlag(plain, { killed: false, global: row(true), workspace: row(false) })).toBe(
      false,
    );
    expect(resolveFlag(plain, { killed: false, global: row(false), workspace: row(true) })).toBe(
      true,
    );
    expect(resolveFlag(plain, { killed: false, workspace: row(true) })).toBe(true);
  });

  it('kill switch over every other layer', () => {
    expect(resolveFlag(plain, { killed: true, global: row(true), workspace: row(true) })).toBe(
      false,
    );
    expect(resolveFlag(plain, { killed: true, workspace: row(true) })).toBe(false);
    expect(resolveFlag(plain, { killed: true, global: row(true) })).toBe(false);
  });
});

describe('isEnabled against the database', () => {
  it('applies each layer for a workspace and leaves other workspaces on the global row', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua } = await seed(tx);
      const ctx = { workspaceId: a.id, userId: ua };
      expect(await isEnabled('pwa.offline', ctx, on(tx))).toBe(false);

      await tx.insert(featureFlag).values({ key: 'pwa.offline', enabled: true, updatedBy: ua });
      expect(await isEnabled('pwa.offline', ctx, on(tx))).toBe(true);

      await withWorkspace(tx, { workspaceId: a.id }, (s) =>
        s.insert(workspaceFeatureFlag).values({
          workspaceId: a.id,
          key: 'pwa.offline',
          enabled: false,
          updatedBy: ua,
        }),
      );
      expect(await isEnabled('pwa.offline', ctx, on(tx))).toBe(false);
      expect(await isEnabled('pwa.offline', { workspaceId: b.id }, on(tx))).toBe(true);

      expect(
        await isEnabled('pwa.offline', { workspaceId: b.id }, on(tx, { KILL_PWA_OFFLINE: true })),
      ).toBe(false);

      const all = await evaluateAll({ workspaceId: b.id }, on(tx));
      expect(all['pwa.offline']).toBe(true);
      expect(all['insights.enabled']).toBe(false);
      expect(Object.values(all).every((v) => typeof v === 'boolean')).toBe(true);
    });
  });

  it('throws for an unknown key', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seed(tx);
      // @ts-expect-error unknown flag keys do not compile
      await expect(isEnabled('nope', { workspaceId: a.id }, on(tx))).rejects.toThrow(
        /Unknown feature flag/,
      );
    });
  });
});
