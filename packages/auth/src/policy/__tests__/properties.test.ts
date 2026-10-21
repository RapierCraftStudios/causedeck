import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ROLE_RANK, ROLES } from '../../roles';
import { ALL_ACTIONS, WRITE_ACTIONS } from '../actions';
import { can, type Actor, type Resource } from '../can';
import { WS } from './fixtures';

const RUNS = { numRuns: 1000 };

const role = fc.constantFrom(...ROLES);
const action = fc.constantFrom(...ALL_ACTIONS);
const id = fc.constantFrom('u1', 'u2', 'u3', 'm1', 'm2');

const settings = fc.record(
  {
    advocatesCanInvite: fc.boolean(),
    ownersSeeRestrictedMatters: fc.boolean(),
  },
  { requiredKeys: [] },
);

const resource = (workspaceId: fc.Arbitrary<string>): fc.Arbitrary<Resource> =>
  fc.record(
    {
      kind: fc.constantFrom('matter', 'document', 'task'),
      workspaceId,
      matterId: id,
      restricted: fc.record({ allowUserIds: fc.array(id, { maxLength: 3 }) }),
      ownerUserId: id,
    },
    { requiredKeys: ['kind', 'workspaceId'] },
  );

const actorOf = (r: fc.Arbitrary<Actor['role']>, workspaceId: fc.Arbitrary<string>) =>
  fc.record(
    {
      userId: id,
      workspaceId,
      role: r,
      assignedMatterIds: fc.array(id, { maxLength: 3 }).map((ids) => new Set(ids)),
      suspended: fc.boolean(),
    },
    { requiredKeys: ['userId', 'workspaceId', 'role'] },
  );

describe('policy properties', () => {
  it('privileges are monotonic by role order viewer < clerk < junior < advocate < owner', () => {
    fc.assert(
      fc.property(role, role, action, fc.boolean(), (a, b, act, withResource) => {
        const [low, high] = ROLE_RANK[a] <= ROLE_RANK[b] ? [a, b] : [b, a];
        // Same user, assigned to the matter, unrestricted: only the role differs.
        const base = { userId: 'u1', workspaceId: WS, assignedMatterIds: new Set(['m1']) };
        const res: Resource | undefined = withResource
          ? { kind: 'matter', workspaceId: WS, matterId: 'm1' }
          : undefined;
        if (can({ ...base, role: low }, act, res).allow) {
          expect(can({ ...base, role: high }, act, res).allow).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('viewer never has a write action', () => {
    fc.assert(
      fc.property(
        actorOf(fc.constant('viewer'), fc.constant(WS)),
        fc.constantFrom(...WRITE_ACTIONS),
        fc.option(resource(fc.constant(WS)), { nil: undefined }),
        settings,
        (viewer, act, res, s) => {
          expect(can(viewer, act, res, s).allow).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it('a resource in another workspace is always CROSS_WORKSPACE', () => {
    fc.assert(
      fc.property(
        actorOf(role, fc.constant('ws-a')),
        action,
        resource(fc.constantFrom('ws-b', 'ws-c', '')),
        settings,
        (a, act, res, s) => {
          expect(can(a, act, res, s)).toEqual({ allow: false, reason: 'CROSS_WORKSPACE' });
        },
      ),
      RUNS,
    );
  });

  it('is total and deterministic', () => {
    fc.assert(
      fc.property(
        actorOf(role, fc.constantFrom('ws-a', 'ws-b')),
        action,
        fc.option(resource(fc.constantFrom('ws-a', 'ws-b')), { nil: undefined }),
        settings,
        (a, act, res, s) => {
          const first = can(a, act, res, s);
          expect(typeof first.allow).toBe('boolean');
          expect(can(a, act, res, s)).toEqual(first);
        },
      ),
      RUNS,
    );
  });
});
