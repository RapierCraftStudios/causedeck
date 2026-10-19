// The allowed dependency map between the domains of `@causedeck/core` (#293). Each key is a folder
// under packages/core/src/; its value lists the other domains it may import, always through their
// `index.ts`. `shared` holds helpers no domain owns and imports no domain. The single source of
// truth for docs/engineering/core-domains.md, `causedeck/core-domain-boundaries` and
// packages/core/src/domains.test.ts.
//
// The issue's example `billing → usage` is deliberately reversed: real code has `usage → billing`
// (usage/limits.ts, budget.ts, fair-use.ts and fairness.ts read billing entitlements), so billing
// must not depend on usage or the map would hold a cycle.

/** @type {Readonly<Record<string, readonly string[]>>} */
export const CORE_DOMAIN_DEPENDENCIES = Object.freeze({
  shared: Object.freeze([]),
  audit: Object.freeze([]),
  workspaces: Object.freeze(['audit']),
  matters: Object.freeze(['workspaces', 'audit']),
  billing: Object.freeze(['workspaces', 'audit']),
  usage: Object.freeze(['audit', 'billing']),
  jobs: Object.freeze(['audit', 'billing', 'usage']),
  runtime: Object.freeze(['audit', 'billing', 'usage', 'workspaces']),
});

/** Every top-level folder of packages/core/src/ (`shared` included). */
export const CORE_DOMAINS = Object.freeze(Object.keys(CORE_DOMAIN_DEPENDENCIES));

/**
 * The first dependency cycle found in `map`, as a path that starts and ends on the same domain
 * (e.g. `['a', 'b', 'a']`), or null when the map is acyclic.
 *
 * @param {Readonly<Record<string, readonly string[]>>} map
 * @returns {string[] | null}
 */
export function findCoreDomainCycle(map) {
  /** @type {Map<string, 'visiting' | 'done'>} */
  const state = new Map();
  /** @type {string[]} */
  const stack = [];

  /** @param {string} domain @returns {string[] | null} */
  const visit = (domain) => {
    const seen = state.get(domain);
    if (seen === 'done') return null;
    if (seen === 'visiting') return [...stack.slice(stack.indexOf(domain)), domain];
    state.set(domain, 'visiting');
    stack.push(domain);
    for (const dependency of map[domain] ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(domain, 'done');
    return null;
  };

  for (const domain of Object.keys(map)) {
    const cycle = visit(domain);
    if (cycle) return cycle;
  }
  return null;
}
