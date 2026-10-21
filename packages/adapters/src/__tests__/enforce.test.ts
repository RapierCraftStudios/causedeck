// Access-mode enforcement for adapters (#369): `AccessModeViolationError` for a `none` resource, a
// registry mode of `none`, a declared mode other than the registry's, and any mode but
// `user_supplied` without counsel's note; built on @causedeck/flags' registry read.
import { AccessModeError } from '@causedeck/flags/access-mode';
import { accessModeRegistry } from '@causedeck/db/schema';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import {
  AccessModeViolationError,
  assertAccessMode,
  assertAdapterAccess,
  createEchoAdapter,
  type AccessMode,
  type AccessModeDeps,
  type Resource,
} from '../index.ts';

async function reasonOf(promise: Promise<void>): Promise<string | undefined> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(AccessModeViolationError);
  expect(error).toBeInstanceOf(AccessModeError);
  expect(error).toMatchObject({ code: 'ACCESS_MODE_DENIED' });
  return (error as AccessModeViolationError).reason;
}

describe('assertAccessMode for adapters', () => {
  it('refuses a declared none, and an unknown mode, without reading the registry', async () => {
    const deps = {
      db: new Proxy(
        {},
        {
          get: () => {
            throw new Error('registry read');
          },
        },
      ),
    } as unknown as AccessModeDeps;
    expect(await reasonOf(assertAccessMode('echo', 'status', 'none', deps))).toBe('mode-none');
    expect(
      await reasonOf(assertAccessMode('echo', 'cause_list', 'official_feed' as AccessMode, deps)),
    ).toBe('unknown-mode');
    expect(
      await reasonOf(assertAccessMode('echo', 'feed' as Resource, 'user_supplied', deps)),
    ).toBe('unknown-mode');
    expect(await reasonOf(assertAdapterAccess(createEchoAdapter(), 'display_board', deps))).toBe(
      'mode-none',
    );
  });

  it('enforces the registry: none, mismatch, disabled, missing and counsel-note rows', async () => {
    await withTestDb(async (tx) => {
      await tx.delete(accessModeRegistry);
      await tx.insert(accessModeRegistry).values([
        { adapterId: 'echo', resource: 'cause_list', mode: 'user_supplied', enabled: true },
        { adapterId: 'echo', resource: 'orders', mode: 'none', enabled: true },
        { adapterId: 'x-hc', resource: 'cause_list', mode: 'official', enabled: true },
        { adapterId: 'x-hc', resource: 'orders', mode: 'licensed', enabled: true },
        { adapterId: 'x-hc', resource: 'status', mode: 'device_user_triggered', enabled: true },
        {
          adapterId: 'x-hc',
          resource: 'display_board',
          mode: 'official',
          enabled: true,
          counselNote: 'Official display-board feed cleared by counsel',
        },
        { adapterId: 'y-hc', resource: 'cause_list', mode: 'user_supplied', enabled: false },
      ]);
      const deps = { db: tx };
      const check = (adapterId: string, resource: Resource, mode: AccessMode) =>
        reasonOf(assertAccessMode(adapterId, resource, mode, deps));

      expect(await check('echo', 'cause_list', 'user_supplied')).toBeUndefined();
      expect(
        await reasonOf(assertAdapterAccess(createEchoAdapter(), 'cause_list', deps)),
      ).toBeUndefined();
      // Registry mode none.
      expect(await check('echo', 'orders', 'user_supplied')).toBe('mode-none');
      // Declared mode exceeds (differs from) the registry mode.
      expect(await check('echo', 'cause_list', 'official')).toBe('mode-mismatch');
      expect(await check('echo', 'cause_list', 'device_user_triggered')).toBe('mode-mismatch');
      // No row (the default) and a disabled row.
      expect(await check('echo', 'status', 'user_supplied')).toBe('no-registry-row');
      expect(await check('y-hc', 'cause_list', 'user_supplied')).toBe('disabled');
      // official, licensed and device_user_triggered need counsel's note.
      expect(await check('x-hc', 'cause_list', 'official')).toBe('no-counsel-note');
      expect(await check('x-hc', 'orders', 'licensed')).toBe('no-counsel-note');
      expect(await check('x-hc', 'status', 'device_user_triggered')).toBe('no-counsel-note');
      expect(await check('x-hc', 'display_board', 'official')).toBeUndefined();
    });
  });
});
