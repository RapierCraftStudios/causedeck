import { describe, expect, it, vi } from 'vitest';

import { assertCan, filterVisible, ForbiddenError } from '../assert';
import { actor, matter, OTHER_WS } from './fixtures';

function spyLogger() {
  return { warn: vi.fn<(obj: object, msg?: string) => void>() };
}

describe('assertCan', () => {
  it('returns silently and logs nothing when allowed', () => {
    const logger = spyLogger();
    expect(() => {
      assertCan(actor('owner'), 'billing.manage', undefined, { logger });
    }).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError with code FORBIDDEN when denied', () => {
    const logger = spyLogger();
    let thrown: unknown;
    try {
      assertCan(actor('viewer'), 'matter.write', undefined, { logger });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ForbiddenError);
    expect(thrown).toMatchObject({
      name: 'ForbiddenError',
      code: 'FORBIDDEN',
      reason: 'ROLE_DENIED',
      action: 'matter.write',
    });
  });

  it('emits one structured denial line with action, role and reason, no resource content', () => {
    const logger = spyLogger();
    const secret = matter({
      kind: 'matter-secret-kind',
      matterId: 'matter-secret-id',
      ownerUserId: 'owner-secret',
      restricted: { allowUserIds: ['allow-secret'] },
    });
    expect(() => {
      assertCan(actor('clerk'), 'strategy.read', secret, { logger });
    }).toThrow(ForbiddenError);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [payload, message] = logger.warn.mock.calls[0] ?? [];
    expect(payload).toEqual({
      event: 'authz.denied',
      action: 'strategy.read',
      role: 'clerk',
      reason: 'ROLE_DENIED',
      workspaceId: 'ws-a',
    });
    expect(message).toBe('authorization denied');
    const serialized = JSON.stringify(payload);
    for (const value of ['secret', 'matter-1']) expect(serialized).not.toContain(value);
    try {
      assertCan(actor('clerk'), 'strategy.read', secret, { logger });
    } catch (error) {
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('logs to the console when no logger is injected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => {
      assertCan(actor('viewer'), 'export.run');
    }).toThrow(ForbiddenError);
    expect(warn).toHaveBeenCalledWith(
      'authorization denied',
      expect.objectContaining({ event: 'authz.denied', reason: 'ROLE_DENIED' }),
    );
    warn.mockRestore();
  });
});

describe('filterVisible', () => {
  it('drops restricted, cross-workspace and unassigned items and keeps order', () => {
    const junior = actor('junior', { assignedMatterIds: new Set(['m1', 'm3', 'm4']) });
    const items = [
      matter({ matterId: 'm1' }),
      matter({ matterId: 'm2' }),
      matter({ matterId: 'm3', restricted: { allowUserIds: ['someone-else'] } }),
      matter({ matterId: 'm4', workspaceId: OTHER_WS }),
      matter({ matterId: 'm5', restricted: { allowUserIds: [junior.userId] } }),
    ];
    expect(filterVisible(items, junior).map((item) => item.matterId)).toEqual(['m1', 'm5']);
  });
});
