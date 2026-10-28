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
  // Product activation (#509): a leaf; workspaces records `invite_sent` through it.
  activation: Object.freeze([]),
  workspaces: Object.freeze(['audit', 'activation']),
  // Brief sharing and referral (#507): reads a brief, imports a matter, records activation.
  shares: Object.freeze(['briefs', 'matter-graph', 'activation', 'workspaces']),
  matters: Object.freeze(['workspaces', 'audit']),
  // Court layer (#34): forum catalogue reads and custom forums; role settings through workspaces.
  // The KHC cause-list watch (#482) stages proposals through automation and the import matcher.
  court: Object.freeze(['workspaces', 'automation', 'import', 'matter-graph', 'sources']),
  // Court-day display-board tracking (#493): the board source's clearance through sources. The court
  // day (#58) reads roles through workspaces, audits the hall marker through audit and wraps the
  // canonical next-date proposal and conflict view of matter-graph (imports `index.ts` only).
  // The calendar range (#66) reads forum closures through deadlines (`loadCourtCalendar`).
  'court-day': Object.freeze(['sources', 'matter-graph', 'workspaces', 'audit', 'deadlines']),
  // The hearing outcome (#62): roles through workspaces, the canonical next date through the
  // matter-graph index only, the audit event through audit. It reads the voice proposals and their
  // transcript anchors as rows and imports no other domain.
  hearings: Object.freeze(['matter-graph', 'audit', 'workspaces']),
  // The matter graph (#362): roles and role settings through workspaces, the matter actor through
  // matters. It emits events through its own port and never imports audit or notifications.
  'matter-graph': Object.freeze(['workspaces', 'matters']),
  // The automation engine (#47): membership roles through workspaces, its audit events through
  // audit, and every graph write through the matter-graph services (imports `index.ts` only).
  // Accepting a `memory_item` draft saves it through the memory domain's `acceptMemoryDraft` (#72);
  // confirming an `obligation_from_direction` proposal creates it through obligations (#67).
  automation: Object.freeze(['workspaces', 'audit', 'matter-graph', 'obligations', 'memory']),
  // Case-status watches (#591, D-048): a lookup needs a cleared source through sources, the next-date
  // proposal goes through automation and every proceeding read through matter-graph.
  // The orders poll (#494) stores a fetched order as a capture (the `CaptureJobs` port) and audits it.
  'case-watch': Object.freeze([
    'workspaces',
    'automation',
    'matter-graph',
    'sources',
    'audit',
    'capture',
  ]),
  // Institution portfolios (#663, #498 part 3): the owner check through workspaces, watches through case-watch
  // (status sources) and the matter read probe through matter-graph; clearance through sources.
  portfolio: Object.freeze(['workspaces', 'matter-graph', 'case-watch', 'sources']),
  // The derived listing brief (#60, ADR 0038): the scope and member role through workspaces, the
  // sensitive-matter-safe `summarise` call through ai, graph reads through matter-graph and court-day
  // (imports `index.ts` only).
  briefs: Object.freeze(['workspaces', 'audit', 'matter-graph', 'court-day', 'ai', 'memory']),
  // Continuity (#71): handover notes and what-changed; the scope and role through workspaces, access
  // audit through audit, graph reads through matter-graph, the memory port type through briefs
  // (imports `index.ts` only).
  continuity: Object.freeze(['workspaces', 'audit', 'matter-graph', 'briefs']),
  // Chamber delegation (#63): the member role and the offboarding provider through workspaces,
  // assignment audit through audit, the day and its clashes through court-day (imports `index.ts` only).
  delegation: Object.freeze(['workspaces', 'audit', 'matter-graph', 'court-day']),
  // Client contacts (#82): the member role and settings through workspaces, links as role edges
  // through matter-graph's `setRoleEdge` (imports `index.ts` only).
  people: Object.freeze(['workspaces', 'matter-graph']),
  // WhatsApp number link and OTP (#678, #502 part 1): the membership check through workspaces
  'whatsapp-link': Object.freeze(['workspaces', 'audit', 'capture']),
  // Lawyer memory (#72, ADR 0044): the member's role through workspaces, the sharing change through
  // audit. Matters and people are read from the tables; proposals are confirmed here, never by
  // automation (automation's `memory_item` handler calls `acceptMemoryDraft` through the index).
  memory: Object.freeze(['workspaces', 'audit']),
  // The deadline engine (#494, D-048): court calendars read the notice tables directly (the same
  // read as `listHolidayListings`) and the day arithmetic is the extraction's own, from intelligence.
  deadlines: Object.freeze([]),
  // Official notices (#586, D-048): polling needs a cleared source through sources; matching reads
  // tables and the owner-defined match function only.
  notices: Object.freeze(['workspaces', 'sources']),
  // Public API keys (#624, #487): issuing and revoking check the member's role through workspaces and are audited; a
  // billed call increments the `api.calls` key through usage.
  'api-keys': Object.freeze(['audit', 'usage', 'workspaces']),
  // Change webhooks (#626, #487 part 3): managing endpoints checks the member's role through workspaces and is
  // audited; delivery goes through `@causedeck/fetch`, and events arrive as injected deps (no case-watch import).
  webhooks: Object.freeze(['audit', 'workspaces']),
  // Bulk seat provisioning (#684, #508): CSV runs and SCIM Users are audited and add or remove members through workspaces.
  provisioning: Object.freeze(['audit', 'workspaces']),
  // The public developer API reads (#625, D-048): every record is gated on source clearance and data class through sources.
  'public-api': Object.freeze(['sources']),
  // Conflict-of-interest checks (#500, D-048): each check is audited; party rows are read directly.
  conflicts: Object.freeze(['audit']),
  // The enquiry log (#87): the flag-gated enquiry services over the conflict check, the automation
  // engine's `new_matter` proposals, audit events and membership roles.
  intake: Object.freeze(['audit', 'automation', 'conflicts', 'workspaces']),
  // Client status links (#88, ADR 0049): flag-gated authored links; prefill reads an outward draft through its index.
  'status-links': Object.freeze(['workspaces', 'audit', 'outward']),
  // Cross-checked facts (#499): source agreement and confidence over listing provenance; tables only.
  facts: Object.freeze([]),
  // The review and correction queue (#518, D-049): every staff read of an item's record is audited.
  review: Object.freeze(['audit']),
  billing: Object.freeze(['workspaces', 'audit']),
  usage: Object.freeze(['audit', 'billing']),
  // The AI gateway wiring (#44): budgets through usage, the ai_call writer through audit.
  ai: Object.freeze(['audit', 'usage']),
  // Data lifecycle (#301): export reads audit and checks owners through workspaces.
  // Workspace erase also withdraws the workspace's contributed court documents (#485) through network.
  lifecycle: Object.freeze(['audit', 'workspaces', 'network']),
  // The source registry (#478, D-048): staff changes record `source.changed` through audit.
  sources: Object.freeze(['audit']),
  // The legal news digest (#481): global items and the member's own prefs, no other domain.
  news: Object.freeze([]),
  // Citation verification (#484, D-004): resolves a neutral citation against the global `judgment`
  // corpus; reads tables and `@causedeck/intelligence` only, no other domain.
  citations: Object.freeze([]),
  // The court document network (#485, D-048): contributions need a cleared source through sources and
  // record their events through audit; opt-in, matter and document reads go to the tables directly.
  network: Object.freeze(['audit', 'sources']),
  // Judgment alerts (#497, D-048): member roles and role settings through workspaces; an alert is
  // shown only if `verifyCitation` resolves its judgment (D-004), through citations.
  research: Object.freeze(['workspaces', 'citations']),
  // Drafting (#768): roles through workspaces, facts through the matter-graph index, `draft.exported`
  // through audit and the narrative gateway through ai's index.
  drafting: Object.freeze(['workspaces', 'matter-graph', 'audit', 'ai']),
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
  extraction: Object.freeze(['workspaces', 'ai', 'automation', 'matter-graph', 'deadlines']),
  // Data-ops alerting (#515, D-049): detectors, the alert ledger, routing and auto-response read the
  // global tables directly and import no other domain.
  // Data operations (#515, D-049): a breached parse-yield or conflict-rate detection opens a review
  // item (#518), through review.
  'data-ops': Object.freeze(['review']),
  // Bootstrap import (#57, #548, #549): the plan reads proposals from the tables directly; apply
  // writes every graph row through matter-graph, meters the OCR cap through usage and refuses an
  // expired or edited undo with automation's errors (imports `index.ts` only). The batch (#550)
  // stages list rows as proposals through automation; it reads captures and documents from the
  // tables and never imports capture or jobs (the job bodies in jobs wrap it).
  import: Object.freeze(['matter-graph', 'usage', 'automation']),
  // Zero-entry onboarding (#501, D-048): discovery stages the advocate's matched listings as
  // proposals on an import batch through the import and automation indexes, reads the fetch policy
  // through sources, and types its actor through matter-graph. Nothing is applied here.
  onboarding: Object.freeze(['import', 'automation', 'sources', 'matter-graph']),
  // The migration concierge (#685): runs matter imports through the import domain's apply and undo
  // (imports `index.ts` only) and checks the actor's role through workspaces.
  migration: Object.freeze(['import', 'workspaces']),
  // The obligation service (#67): roles through workspaces, audit events through audit, defect
  // transitions through the matter-graph state machine (imports `index.ts` only).
  obligations: Object.freeze(['workspaces', 'audit', 'matter-graph']),
  // Stale-matter attention (#70): roles and the threshold through workspaces, audit events through
  // audit, date arithmetic through the obligations index.
  attention: Object.freeze(['workspaces', 'audit', 'obligations']),
  // A0 grid corrections (#558): roles and the owner's eval-reuse switch through workspaces.
  corrections: Object.freeze(['workspaces']),
  // Outward update drafts (#735, ADR 0045): roles through workspaces, audit events through audit,
  // the narrative through the AI gateway wiring in ai; reads graph rows from the tables.
  outward: Object.freeze(['workspaces', 'audit', 'matter-graph', 'ai', 'memory']),
  // Recognition-based matching (#74): M7 aliases rank candidates and a correction files an alias
  // proposal, both through memory's index (a hint only, never an auto-apply).
  matching: Object.freeze(['memory']),
  // The end-of-day digest (#49) counts activity through the automation domain's public index.
  // `capture.process` builds the AI gateway for the document pipeline (#45) through ai's index.
  jobs: Object.freeze([
    'obligations',
    'attention',
    'ai',
    'intake',
    'audit',
    'billing',
    'usage',
    'lifecycle',
    'support',
    'capture',
    'automation',
    'calendar',
    'whatsapp',
    'whatsapp-link',
    'memory',
    'voice',
    'email-intake',
    'extraction',
    'import',
    'news',
    'sources',
    'data-ops',
    'court',
    'court-day',
    'briefs',
    'delegation',
    'sources',
    'notices',
    'research',
    'drafting',
    'portfolio',
    'business',
    'case-watch',
    'webhooks',
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
