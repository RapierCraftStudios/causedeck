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
  // Court layer (#34): forum catalogue reads and custom forums; role settings through workspaces.
  court: Object.freeze(['workspaces']),
  // The matter graph (#362): roles and role settings through workspaces, the matter actor through
  // matters. It emits events through its own port and never imports audit or notifications.
  'matter-graph': Object.freeze(['workspaces', 'matters']),
  // The automation engine (#47): membership roles through workspaces, its audit events through
  // audit, and every graph write through the matter-graph services (imports `index.ts` only).
  automation: Object.freeze(['workspaces', 'audit', 'matter-graph']),
  billing: Object.freeze(['workspaces', 'audit']),
  usage: Object.freeze(['audit', 'billing']),
  // The AI gateway wiring (#44): budgets through usage, the ai_call writer through audit.
  ai: Object.freeze(['audit', 'usage']),
  // Data lifecycle (#301): export reads audit and checks owners through workspaces.
  lifecycle: Object.freeze(['audit', 'workspaces']),
  // Staff support sessions (#308): owner checks through workspaces, session events through audit.
  support: Object.freeze(['workspaces', 'audit']),
  // Capture inbox (#43): file intake, channels, scan and retention; events through audit, jobs
  // arrive as a port (it never imports jobs).
  capture: Object.freeze(['audit']),
  // Calendar interop (#53): the ICS feed and import. Roles and role settings through workspaces,
  // the importer's capture through capture, proposals through automation and every graph read or
  // write through matter-graph (imports `index.ts` only); the feed token events go through audit.
  calendar: Object.freeze(['audit', 'workspaces', 'capture', 'automation', 'matter-graph']),
  // WhatsApp chat import (#526): intake and the structuring job body. The capture row and its
  // retention through capture, the `structure_chat` call through ai, proposals through automation,
  // evidence documents through matter-graph, member roles through workspaces.
  whatsapp: Object.freeze(['audit', 'workspaces', 'capture', 'ai', 'automation', 'matter-graph']),
  // The end-of-day digest (#49) counts activity through the automation domain's public index.
  // `capture.process` builds the AI gateway for the document pipeline (#45) through ai's index.
  jobs: Object.freeze([
    'ai',
    'audit',
    'billing',
    'usage',
    'lifecycle',
    'support',
    'capture',
    'automation',
    'calendar',
    'whatsapp',
  ]),
  // Support wrappers (#313): the owner's settings page, the shell banner and the staff request.
  // Court wrappers (#434): the roster preview from an upload and confirm-then-detect.
  runtime: Object.freeze([
    'audit',
    'billing',
    'usage',
    'workspaces',
    'jobs',
    'lifecycle',
    'support',
    'court',
    'capture',
    'automation',
  ]),
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
