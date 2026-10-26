// Draft access rules (#768): the role check is FORBIDDEN for a clerk or viewer on every draft action
// and allowed for owner, advocate and junior; a draft without a matter needs only the role.
import type { Role } from '@causedeck/auth';
import type { Actor } from '@causedeck/auth/policy';
import type { Transaction } from '@causedeck/db';
import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../../shared/errors.ts';
import { requireDraftAction, requireMatterAccess, type DraftAction } from '../policy.ts';

const ACTIONS: DraftAction[] = ['draft.read', 'draft.write', 'draft.export'];
const actor = (role: Role): Actor => ({ workspaceId: 'w', userId: 'u', role });

describe('requireDraftAction', () => {
  it.each(['owner', 'advocate', 'junior'] as const)('allows %s', (role) => {
    for (const action of ACTIONS) {
      expect(() => {
        requireDraftAction(actor(role), {}, action);
      }, action).not.toThrow();
    }
  });

  it.each(['clerk', 'viewer'] as const)('denies %s with FORBIDDEN', (role) => {
    for (const action of ACTIONS) {
      try {
        requireDraftAction(actor(role), {}, action);
        expect.unreachable(action);
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceError);
        expect((error as WorkspaceError).code).toBe('FORBIDDEN');
      }
    }
  });
});

describe('requireMatterAccess', () => {
  it('applies only the role check to a draft without a matter', async () => {
    const tx = {} as Transaction;
    await expect(
      requireMatterAccess(tx, actor('advocate'), {}, null, 'draft.export'),
    ).resolves.toBeUndefined();
    await expect(
      requireMatterAccess(tx, actor('clerk'), {}, null, 'draft.export'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
