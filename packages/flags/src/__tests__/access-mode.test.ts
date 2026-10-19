// Access-mode registry enforcement (#22, PRD CL-6): deny without an enabled row for exactly the
// requested mode; `none` always denies; the launch seeds allow `user_supplied` for madras-hc.
import { accessModeRegistry } from '@causedeck/db/schema';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import {
  AccessModeError,
  assertAccessMode,
  decideAccessMode,
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
