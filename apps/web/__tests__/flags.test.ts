// apps/web flag wiring (#22): flags are evaluated server-side for the workspace, a disabled flag
// turns into a plain 404 (`notFound()`), and the LISTEN invalidation starts once per process.
import type * as FlagsServer from '@causedeck/flags/server';
import { FlagOffError } from '@causedeck/flags/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testWorkspaceContext } from './helpers/workspace.ts';

const server = vi.hoisted(() => ({
  evaluateAll: vi.fn(),
  requireFlag: vi.fn(),
  startFlagListener: vi.fn(() => Promise.resolve({ unlisten: () => Promise.resolve() })),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@causedeck/db', () => ({ db: { $client: {} } }));
vi.mock('@causedeck/flags', () => ({ startFlagListener: server.startFlagListener }));
vi.mock('@causedeck/flags/server', async (importOriginal) => ({
  ...(await importOriginal<typeof FlagsServer>()),
  evaluateAll: server.evaluateAll,
  requireFlag: server.requireFlag,
}));

const { getWorkspaceFlags, requireWorkspaceFlag, workspaceFlagCheck } =
  await import('../lib/flags.ts');

const context = testWorkspaceContext('demo');

beforeEach(() => {
  server.evaluateAll.mockReset();
  server.requireFlag.mockReset();
});

describe('lib/flags', () => {
  it('evaluates every flag for the workspace and the signed-in user', async () => {
    server.evaluateAll.mockResolvedValue({ 'invoices.enabled': false, 'insights.enabled': true });
    const check = await workspaceFlagCheck(context);
    expect(server.evaluateAll).toHaveBeenCalledWith({
      workspaceId: context.workspace.id,
      userId: context.user.id,
    });
    expect(check('insights.enabled')).toBe(true);
    expect(check('invoices.enabled')).toBe(false);
    await expect(getWorkspaceFlags(context)).resolves.toMatchObject({ 'insights.enabled': true });
  });

  it('maps FEATURE_OFF to notFound so a dark feature looks like a missing route', async () => {
    server.requireFlag.mockRejectedValue(new FlagOffError());
    await expect(requireWorkspaceFlag('invoices.enabled', context)).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(server.requireFlag).toHaveBeenCalledWith('invoices.enabled', {
      workspaceId: context.workspace.id,
      userId: context.user.id,
    });
  });

  it('lets other errors through and passes when the flag is on', async () => {
    server.requireFlag.mockRejectedValueOnce(new Error('db down'));
    await expect(requireWorkspaceFlag('limitation.enabled', context)).rejects.toThrow('db down');
    server.requireFlag.mockResolvedValueOnce(undefined);
    await expect(requireWorkspaceFlag('limitation.enabled', context)).resolves.toBeUndefined();
  });

  it('starts LISTEN flag_changed once per process', async () => {
    server.evaluateAll.mockResolvedValue({});
    await getWorkspaceFlags(testWorkspaceContext('demo'));
    await requireWorkspaceFlag('pwa.offline', context).catch(() => undefined);
    await vi.waitFor(() => {
      expect(server.startFlagListener).toHaveBeenCalledTimes(1);
    });
  });
});
