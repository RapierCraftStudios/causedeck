// Legal-gated (⚖) flags ship dark: off on a fresh database, never on from a workspace row alone,
// and on only through a staff action that records `legal_ack_by` and a note (#22, ADR 0010).
import { withWorkspace } from '@causedeck/db';
import { featureFlag, workspaceFeatureFlag } from '@causedeck/db/schema';
import { withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { FlagAdminError } from '../admin.ts';
import { asStaff, setFlag, setWorkspaceFlag } from '../admin.ts';
import { evaluateAll, isEnabled } from '../evaluate.ts';
import { FLAG_KEYS, FLAGS } from '../keys.ts';

import { on, seed } from './helpers.ts';

const LEGAL_KEYS = FLAG_KEYS.filter((key) => FLAGS[key].legalGated);

describe('legal-gated flags', () => {
  it('are all off on a fresh database', async () => {
    expect(LEGAL_KEYS.length).toBe(7);
    await withTestDb(async (tx) => {
      const { a, b } = await seed(tx);
      expect(await tx.select().from(featureFlag)).toEqual([]);
      for (const workspaceId of [a.id, b.id]) {
        const all = await evaluateAll({ workspaceId }, on(tx));
        for (const key of LEGAL_KEYS) expect(all[key], key).toBe(false);
      }
    });
  });

  it('cannot be enabled by a workspace row alone, even one with a legal ack', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seed(tx);
      for (const key of LEGAL_KEYS) {
        await withWorkspace(tx, { workspaceId: a.id }, (s) =>
          s.insert(workspaceFeatureFlag).values({
            workspaceId: a.id,
            key,
            enabled: true,
            legalAckBy: ua,
            legalAckNote: 'pilot',
            updatedBy: ua,
          }),
        );
        expect(await isEnabled(key, { workspaceId: a.id }, on(tx)), key).toBe(false);
      }
    });
  });

  it('cannot be enabled by a global row without a legal ack', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seed(tx);
      await tx
        .insert(featureFlag)
        .values({ key: 'invoices.enabled', enabled: true, updatedBy: ua });
      expect(await isEnabled('invoices.enabled', { workspaceId: a.id }, on(tx))).toBe(false);
    });
  });

  it('needs a legal_ack note to enable, and records who acknowledged it', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua } = await seed(tx);
      const staff = asStaff(ua);
      await expect(setFlag(tx, staff, { key: 'invoices.enabled', enabled: true })).rejects.toThrow(
        expect.objectContaining({ code: 'LEGAL_ACK_REQUIRED' }) as FlagAdminError,
      );
      await expect(
        setFlag(tx, staff, { key: 'invoices.enabled', enabled: true, legalAckNote: '   ' }),
      ).rejects.toThrow(/legal_ack/);
      expect(await isEnabled('invoices.enabled', { workspaceId: a.id }, on(tx))).toBe(false);

      await setFlag(tx, staff, {
        key: 'invoices.enabled',
        enabled: true,
        legalAckNote: 'Counsel GST/RCM review #120',
      });
      const [stored] = await tx
        .select()
        .from(featureFlag)
        .where(eq(featureFlag.key, 'invoices.enabled'));
      expect(stored).toMatchObject({
        enabled: true,
        legalAckBy: ua,
        legalAckNote: 'Counsel GST/RCM review #120',
        updatedBy: ua,
      });
      expect(await isEnabled('invoices.enabled', { workspaceId: a.id }, on(tx))).toBe(true);

      // A workspace may still opt out, and a staff ack lets a workspace row keep it on.
      await setWorkspaceFlag(tx, staff, {
        workspaceId: b.id,
        key: 'invoices.enabled',
        enabled: false,
      });
      expect(await isEnabled('invoices.enabled', { workspaceId: b.id }, on(tx))).toBe(false);
      await setWorkspaceFlag(tx, staff, {
        workspaceId: b.id,
        key: 'invoices.enabled',
        enabled: true,
        legalAckNote: 'Pilot approved by counsel',
      });
      expect(await isEnabled('invoices.enabled', { workspaceId: b.id }, on(tx))).toBe(true);

      // Turning it off clears the acknowledgement.
      await setFlag(tx, staff, { key: 'invoices.enabled', enabled: false });
      const [off] = await tx
        .select()
        .from(featureFlag)
        .where(eq(featureFlag.key, 'invoices.enabled'));
      expect(off).toMatchObject({ enabled: false, legalAckBy: null, legalAckNote: null });
      expect(await isEnabled('invoices.enabled', { workspaceId: b.id }, on(tx))).toBe(false);
    });
  });

  it('rejects a legal ack without a note at the database level', async () => {
    await withTestDb(async (tx) => {
      const { ua } = await seed(tx);
      await expect(
        tx.transaction((sp) =>
          sp
            .insert(featureFlag)
            .values({ key: 'limitation.enabled', enabled: true, legalAckBy: ua, updatedBy: ua }),
        ),
      ).rejects.toThrow();
    });
  });
});
