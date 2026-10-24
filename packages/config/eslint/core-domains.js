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
  // The KHC cause-list watch (#482) stages proposals through automation and the import matcher.
  court: Object.freeze(['workspaces', 'automation', 'import', 'matter-graph', 'sources']),
  // Court-day display-board tracking (#493): the board source's clearance through sources.
  'court-day': Object.freeze(['sources']),
  // The matter graph (#362): roles and role settings through workspaces, the matter actor through
  // matters. It emits events through its own port and never imports audit or notifications.
  'matter-graph': Object.freeze(['workspaces', 'matters']),
  // The automation engine (#47): membership roles through workspaces, its audit events through
  // audit, and every graph write through the matter-graph services (imports `index.ts` only).
  automation: Object.freeze(['workspaces', 'audit', 'matter-graph']),
  // Case-status watches (#591, D-048): a lookup needs a cleared source through sources, the next-date
  // proposal goes through automation and every proceeding read through matter-graph.
  'case-watch': Object.freeze(['workspaces', 'automation', 'matter-graph', 'sources']),
  // Official notices (#586, D-048): polling needs a cleared source through sources; matching reads
  // tables and the owner-defined match function only.
  notices: Object.freeze(['sources']),
  // Public API keys (#624, #487): issuing and revoking check the member's role through workspaces; a
  // billed call increments the `api.calls` key through usage.
  'api-keys': Object.freeze(['usage', 'workspaces']),
  billing: Object.freeze(['workspaces', 'audit']),
  usage: Object.freeze(['audit', 'billing']),
  // The AI gateway wiring (#44): budgets through usage, the ai_call writer through audit.
  ai: Object.freeze(['audit', 'usage']),
  // Data lifecycle (#301): export reads audit and checks owners through workspaces.
  // Workspace erase also withdraws the workspace's contributed court documents (#485) through network.
  lifecycle: Object.freeze(['audit', 'workspaces', 'network']),
  // The source registry (#478, D-048): staff changes record `source.changed` through audit.
  sources: Object.freeze(['audit']),
  // Citation verification (#484, D-004): resolves a neutral citation against the global `judgment`
  // corpus; reads tables and `@causedeck/intelligence` only, no other domain.
  citations: Object.freeze([]),
  // The court document network (#485, D-048): contributions need a cleared source through sources and
  // record their events through audit; opt-in, matter and document reads go to the tables directly.
  network: Object.freeze(['audit', 'sources']),
  // Judgment alerts (#497, D-048): member roles and role settings through workspaces; an alert is
  // shown only if `verifyCitation` resolves its judgment (D-004), through citations.
  research: Object.freeze(['workspaces', 'citations']),
  // Staff support sessions (#308): owner checks through workspaces, session events through audit.
  support: Object.freeze(['workspaces', 'audit']),
  // The business dashboard (#519): the IST month through usage's `periodStart`, FORBIDDEN through workspaces.
  business: Object.freeze(['usage', 'workspaces']),
  // Capture inbox (#43): file intake, channels, scan and retention; events through audit, jobs
  // arrive as a port (it never imports jobs). The diary-photo step (#52) runs in the pipeline's
  // transaction: the `structure_diary` call through ai, member roles through workspaces, proposals
  // through automation and every graph read through matter-graph (imports `index.ts` only).
  capture: Object.freeze(['audit', 'workspaces', 'ai', 'automation', 'matter-graph']),
  // Calendar interop (#53): the ICS feed and import. Roles and role settings through workspaces,
  // the importer's capture through capture, proposals through automation and every graph read or
  // write through matter-graph (imports `index.ts` only); the feed token events go through audit.
  calendar: Object.freeze(['audit', 'workspaces', 'capture', 'automation', 'matter-graph']),
  // Email forward-in intake (#54, #530): per-user addresses and the sender allow-list; events
  // through audit, the `email` channel and the captures the `email.intake` body stores through the
  // capture domain's public index, drafts through automation, matters through matter-graph, the
  // member's role through workspaces.
  'email-intake': Object.freeze(['audit', 'capture', 'automation', 'matter-graph', 'workspaces']),
  // WhatsApp chat import (#526): intake and the structuring job body. The capture row and its
  // retention through capture, the `structure_chat` call through ai, proposals through automation,
  // evidence documents through matter-graph, member roles through workspaces.
  whatsapp: Object.freeze(['audit', 'workspaces', 'capture', 'ai', 'automation', 'matter-graph']),
  // Voice capture (#542): the `voice.process` job body. The capture row through capture, the
  // `transcribe` and `structure_hearing` calls through ai, proposals through automation, the
  // transcript document through matter-graph, member roles through workspaces.
  voice: Object.freeze(['workspaces', 'capture', 'ai', 'automation', 'matter-graph']),
  // Anchored order extraction (#46): the `extract_order` call through ai, proposals through
  // automation, graph reads through matter-graph (imports `index.ts` only), member roles through
  // workspaces.
  extraction: Object.freeze(['workspaces', 'ai', 'automation', 'matter-graph']),
  // Data-ops alerting (#515, D-049): detectors, the alert ledger, routing and auto-response read the
  // global tables directly and import no other domain.
  'data-ops': Object.freeze([]),
  // Bootstrap import (#57, #548, #549): the plan reads proposals from the tables directly; apply
  // writes every graph row through matter-graph, meters the OCR cap through usage and refuses an
  // expired or edited undo with automation's errors (imports `index.ts` only). The batch (#550)
  // stages list rows as proposals through automation; it reads captures and documents from the
  // tables and never imports capture or jobs (the job bodies in jobs wrap it).
  import: Object.freeze(['matter-graph', 'usage', 'automation']),
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
    'voice',
    'email-intake',
    'extraction',
    'import',
    'data-ops',
    'court',
    'court-day',
    'sources',
    'notices',
    'research',
    'business',
    'case-watch',
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
    'email-intake',
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
