// Adapter registry (#369): register once, resolve by id or forum code, list sorted by id.
import { describe, expect, it } from 'vitest';

import {
  AdapterRegistrationError,
  createAdapterRegistry,
  createEchoAdapter,
  ECHO_FORUM_CODE,
  listAdapters,
  register,
  resolveByForum,
  resolveById,
  type CourtAdapter,
} from '../index.ts';

const variant = (overrides: Partial<CourtAdapter>): CourtAdapter => ({
  ...createEchoAdapter(),
  ...overrides,
});

describe('adapter registry', () => {
  it('resolves by id and by forum code and lists adapters by id', () => {
    const registry = createAdapterRegistry();
    const echo = createEchoAdapter();
    const alpha = variant({ id: 'alpha', forumCodes: ['test.alpha.principal'] });
    registry.register(echo);
    registry.register(alpha);
    expect(registry.resolveById('echo')).toBe(echo);
    expect(registry.resolveByForum(ECHO_FORUM_CODE)).toBe(echo);
    expect(registry.resolveByForum('test.alpha.principal')).toBe(alpha);
    expect(registry.resolveById('missing')).toBeUndefined();
    expect(registry.resolveByForum('test.missing.principal')).toBeUndefined();
    expect(registry.listAdapters().map((a) => a.id)).toEqual(['alpha', 'echo']);
  });

  it('rejects a duplicate id, a taken forum code and an invalid descriptor', () => {
    const registry = createAdapterRegistry();
    registry.register(createEchoAdapter());
    const adding = (adapter: CourtAdapter) => () => {
      registry.register(adapter);
    };
    expect(adding(createEchoAdapter())).toThrow(AdapterRegistrationError);
    expect(adding(variant({ id: 'other' }))).toThrow(/already has adapter echo/);
    expect(adding(variant({ id: 'Bad Id', forumCodes: ['x.y'] }))).toThrow(
      AdapterRegistrationError,
    );
    expect(adding(variant({ id: 'nover', version: 'v1', forumCodes: ['x.z'] }))).toThrow(/semver/);
    expect(adding(variant({ id: 'noforum', forumCodes: [] }))).toThrow(AdapterRegistrationError);
  });

  it('accepts dotted adapter ids and rejects malformed ones (#395)', () => {
    const registry = createAdapterRegistry();
    registry.register(
      variant({ id: 'in.tn.madras-hc.principal', forumCodes: ['test.dotted.principal'] }),
    );
    expect(registry.resolveById('in.tn.madras-hc.principal')?.id).toBe('in.tn.madras-hc.principal');
    for (const [index, id] of ['In.x', 'a..b', 'a.', '.a', 'a.1b'].entries()) {
      expect(() => {
        registry.register(variant({ id, forumCodes: [`test.bad${String(index)}.principal`] }));
      }, id).toThrow(AdapterRegistrationError);
    }
  });

  it('has a process-wide default registry', () => {
    const adapter = variant({ id: 'default-test', forumCodes: ['test.default.principal'] });
    register(adapter);
    expect(resolveById('default-test')).toBe(adapter);
    expect(resolveByForum('test.default.principal')).toBe(adapter);
    expect(listAdapters()).toContain(adapter);
  });
});
