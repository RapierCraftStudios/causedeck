// Every action the permission policy decides on, grouped by domain (#231). `can()` denies anything
// not listed here, so a new feature adds its actions here and its row to `matrix.ts`.

export const ACTIONS = {
  workspace: ['workspace.manage', 'workspace.rename', 'workspace.delete'],
  member: ['member.invite', 'member.remove', 'member.role'],
  billing: ['billing.manage', 'billing.read', 'invoices.read'],
  matter: ['matter.read', 'matter.write', 'matter.restrict'],
  strategy: ['strategy.read'],
  memory: ['memory.read', 'memory.write'],
  document: ['document.read', 'document.write'],
  task: ['task.read', 'task.write'],
  listing: ['listing.read'],
  draft: ['draft.write'],
  audit: ['audit.read'],
  // The workspace-wide court-day view (#58); `mine` needs no action beyond `listing.read`.
  court_day: ['court_day.view_all'],
  // Chamber delegation of appearances (#63).
  appearance: ['appearance.assign'],
  // Client contacts (#82): `contact.write` is the owner/advocate manage; a junior writes through
  // `matter.write` on an assigned matter (`@causedeck/core/people`).
  contact: ['contact.read', 'contact.write'],
  // The inbound enquiry log (#87, ADR 0043): advocate-level read and write.
  enquiry: ['enquiry.read', 'enquiry.write'],
  export: ['export.run'],
  support: ['support.manage'],
  // Shell surfaces gated in apps/web/lib/workspace-context.ts.
  shell: ['limitation.read', 'insights.read', 'settings.read'],
} as const;

export type ActionDomain = keyof typeof ACTIONS;
export type Action = (typeof ACTIONS)[ActionDomain][number];

export const ALL_ACTIONS: readonly Action[] = Object.values(ACTIONS).flat();

const DOMAIN_OF: ReadonlyMap<string, ActionDomain> = new Map(
  (Object.keys(ACTIONS) as ActionDomain[]).flatMap((domain) =>
    ACTIONS[domain].map((action) => [action, domain] as const),
  ),
);

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && DOMAIN_OF.has(value);
}

export function domainOf(action: Action): ActionDomain {
  const domain = DOMAIN_OF.get(action);
  if (domain === undefined) throw new Error(`Unknown action: ${action}`);
  return domain;
}

/** Actions that change state: every verb other than `read`. */
export const WRITE_ACTIONS: readonly Action[] = ALL_ACTIONS.filter(
  (action) => !action.endsWith('.read'),
);
