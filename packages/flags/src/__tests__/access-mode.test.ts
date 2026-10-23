// Access-mode registry enforcement (#22, PRD CL-6): deny without an enabled row for exactly the
// requested mode; `none` always denies; any mode but `user_supplied` also needs a counsel note
// (#369); the launch seeds allow `user_supplied` for madras-hc.
import { accessModeRegistry } from '@causedeck/db/schema';
import { withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  AccessModeError,
  assertAccessMode,
  decideAccessMode,
  listAccessModeRegistry,
  listAdapterAccessModes,
  type AccessMode,
} from '../access-mode.ts';
import { ACCESS_MODE_SEED, seedAccessModes } from '../seed.ts';

describe('decideAccessMode', () => {
  it('denies each failing case with its reason', () => {
    expect(decideAccessMode(undefined, 'user_supplied')).toEqual({
      allowed: false,
      reason: 'no-registry-row',
    });
    expect(decideAccessMode({ mode: 'user_supplied', enabled: false }, 'user_supplied')).toEqual({
      allowed: false,
      reason: 'disabled',
    });
    expect(decideAccessMode({ mode: 'none', enabled: true }, 'user_supplied')).toEqual({
      allowed: false,
      reason: 'mode-none',
    });
    expect(decideAccessMode({ mode: 'user_supplied', enabled: true }, 'none')).toEqual({
      allowed: false,
      reason: 'mode-none',
    });
    expect(decideAccessMode({ mode: 'user_supplied', enabled: true }, 'official')).toEqual({
      allowed: false,
      reason: 'mode-mismatch',
    });
    expect(decideAccessMode({ mode: 'user_supplied', enabled: true }, 'scrape')).toEqual({
      allowed: false,
      reason: 'unknown-mode',
    });
    expect(decideAccessMode({ mode: 'user_supplied', enabled: true }, 'user_supplied')).toEqual({
      allowed: true,
    });
  });
});

describe('the counsel-note gate (#369)', () => {
  it('denies device_user_triggered, official and licensed rows without a counsel note', () => {
    for (const mode of ['device_user_triggered', 'official', 'licensed'] as const) {
      expect(decideAccessMode({ mode, enabled: true }, mode), mode).toEqual({
        allowed: false,
        reason: 'no-counsel-note',
      });
      expect(decideAccessMode({ mode, enabled: true, counselNote: null }, mode), mode).toEqual({
        allowed: false,
        reason: 'no-counsel-note',
      });
      expect(decideAccessMode({ mode, enabled: true, counselNote: '  ' }, mode), mode).toEqual({
        allowed: false,
        reason: 'no-counsel-note',
      });
      expect(
        decideAccessMode({ mode, enabled: true, counselNote: 'Cleared in memo #118' }, mode),
        mode,
      ).toEqual({ allowed: true });
    }
  });

  it('does not need a counsel note for user_supplied', () => {
    expect(decideAccessMode({ mode: 'user_supplied', enabled: true }, 'user_supplied')).toEqual({
      allowed: true,
    });
  });

  it('reads the counsel note from the registry row', async () => {
    await withTestDb(async (tx) => {
      await tx.delete(accessModeRegistry);
      await tx.insert(accessModeRegistry).values([
        { adapterId: 'x-hc', resource: 'cause_list', mode: 'official', enabled: true },
        {
          adapterId: 'x-hc',
          resource: 'orders',
          mode: 'licensed',
          enabled: true,
          counselNote: 'Licence agreement reviewed by counsel',
        },
      ]);
      const deps = { db: tx };
      const error = await assertAccessMode(
        { adapterId: 'x-hc', resource: 'cause_list', requestedMode: 'official' },
        deps,
      ).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AccessModeError);
      expect(error).toMatchObject({ reason: 'no-counsel-note' });
      await expect(
        assertAccessMode(
          { adapterId: 'x-hc', resource: 'orders', requestedMode: 'licensed' },
          deps,
        ),
      ).resolves.toBeUndefined();
    });
  });
});

describe('assertAccessMode against the registry', () => {
  it('allows the madras-hc user_supplied seed and denies everything else', async () => {
    await withTestDb(async (tx) => {
      await tx.delete(accessModeRegistry);
      expect(await seedAccessModes(tx)).toBe(ACCESS_MODE_SEED.length);
      expect(await seedAccessModes(tx)).toBe(ACCESS_MODE_SEED.length);
      const deps = { db: tx };

      await expect(
        assertAccessMode(
          { adapterId: 'madras-hc', resource: 'case-status', requestedMode: 'user_supplied' },
          deps,
        ),
      ).resolves.toBeUndefined();
      await expect(
        assertAccessMode(
          { adapterId: 'karnataka-hc', resource: 'case-status', requestedMode: 'user_supplied' },
          deps,
        ),
      ).resolves.toBeUndefined();

      const denied = async (adapterId: string, resource: string, requestedMode: AccessMode) => {
        const error = await assertAccessMode({ adapterId, resource, requestedMode }, deps).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(AccessModeError);
        expect(error).toMatchObject({ code: 'ACCESS_MODE_DENIED' });
        return (error as AccessModeError).reason;
      };
      // No registry row.
      expect(await denied('bombay-hc', 'case-status', 'user_supplied')).toBe('no-registry-row');
      // Present but disabled: every A2 / live-tracking / push row.
      expect(await denied('madras-hc', 'a2-retrieval', 'device_user_triggered')).toBe('disabled');
      expect(await denied('madras-hc', 'live-tracking', 'device_user_triggered')).toBe('disabled');
      expect(await denied('karnataka-hc', 'sanctioned-push', 'official')).toBe('disabled');
      // Mode none, and a mode other than the registered one.
      expect(await denied('madras-hc', 'case-status', 'none')).toBe('mode-none');
      expect(await denied('madras-hc', 'case-status', 'official')).toBe('mode-mismatch');

      await tx
        .insert(accessModeRegistry)
        .values({ adapterId: 'x-hc', resource: 'r', mode: 'none', enabled: true });
      expect(await denied('x-hc', 'r', 'user_supplied')).toBe('mode-none');
    });
  });

  it('seeds every A2, live-tracking and push row disabled', () => {
    for (const adapterId of ['madras-hc', 'karnataka-hc']) {
      const rows = ACCESS_MODE_SEED.filter((r) => r.adapterId === adapterId);
      expect(rows.find((r) => r.resource === 'case-status')).toMatchObject({
        mode: 'user_supplied',
        enabled: true,
      });
      for (const resource of ['a2-retrieval', 'live-tracking', 'sanctioned-push']) {
        expect(
          rows.find((r) => r.resource === resource),
          `${adapterId}/${resource}`,
        ).toMatchObject({ enabled: false });
      }
    }
  });
});

describe('listAccessModeRegistry', () => {
  it('lists every registry row ordered by adapter, then resource (#312)', async () => {
    await withTestDb(async (tx) => {
      await tx.delete(accessModeRegistry);
      expect(await listAccessModeRegistry(tx)).toEqual([]);
      await seedAccessModes(tx);
      const rows = await listAccessModeRegistry(tx);
      const expected = [...ACCESS_MODE_SEED]
        .sort(
          (a, b) => a.adapterId.localeCompare(b.adapterId) || a.resource.localeCompare(b.resource),
        )
        .map(({ adapterId, resource, mode, enabled }) => ({
          adapterId,
          resource,
          mode,
          enabled,
          reviewedAt: null,
        }));
      expect(rows).toEqual(expected);
    });
  });
});

describe('listAdapterAccessModes', () => {
  it("lists one adapter's rows by resource, with counsel's note (#397)", async () => {
    await withTestDb(async (tx) => {
      await tx.delete(accessModeRegistry);
      expect(await listAdapterAccessModes(tx, 'madras-hc')).toEqual([]);
      await seedAccessModes(tx);
      await tx
        .update(accessModeRegistry)
        .set({ counselNote: 'Cleared for lawyer-supplied lists.' })
        .where(
          and(
            eq(accessModeRegistry.adapterId, 'madras-hc'),
            eq(accessModeRegistry.resource, 'case-status'),
          ),
        );
      const rows = await listAdapterAccessModes(tx, 'madras-hc');
      const expected = ACCESS_MODE_SEED.filter((row) => row.adapterId === 'madras-hc')
        .sort((a, b) => a.resource.localeCompare(b.resource))
        .map(({ resource, mode, enabled }) => ({
          resource,
          mode,
          enabled,
          counselNote: resource === 'case-status' ? 'Cleared for lawyer-supplied lists.' : null,
          reviewedAt: null,
        }));
      expect(rows).toEqual(expected);
      expect(await listAdapterAccessModes(tx, 'in.tn.madras-hc.principal')).toEqual([]);
    });
  });
});
