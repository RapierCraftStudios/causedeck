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
