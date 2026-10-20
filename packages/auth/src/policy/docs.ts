// Renders `docs/engineering/permissions.md` from the matrix (#231). Pure; the file is written by
// `packages/auth/scripts/gen-permissions-doc.ts` (`pnpm docs:permissions`).
import { atLeast, ROLES } from '../role-rank';
import { ACTIONS, type ActionDomain } from './actions';
import { DENY_REASONS } from './can';
import { MATRIX } from './matrix';

const REASON_NOTES: Record<(typeof DENY_REASONS)[number], string> = {
  ROLE_DENIED: 'the role is below the action’s minimum, or the action is unknown',
  RESTRICTED_MATTER: 'the matter is restricted and the user is not on its allow list',
  CROSS_WORKSPACE: 'the resource belongs to another workspace (checked first, for every role)',
  NOT_ASSIGNED: 'a junior acting on a matter not assigned to, shared with or owned by them',
  FEATURE_OFF: 'the action’s domain is switched off for the workspace',
  SUSPENDED: 'the member is suspended',
};

function table(domain: ActionDomain): string[] {
  const header = `| Action | ${ROLES.join(' | ')} |`;
  const rule = `| ------ | ${ROLES.map((role) => '-'.repeat(role.length)).join(' | ')} |`;
  const rows = ACTIONS[domain].map((action) => {
    const cells = ROLES.map((role) =>
      (atLeast(role, MATRIX[action]) ? '✓' : '—').padEnd(role.length),
    );
    return `| \`${action}\` | ${cells.join(' | ')} |`;
  });
  return [header, rule, ...rows];
}

export function renderPermissionsDoc(): string {
  const lines: string[] = [
    '# Permissions',
    '',
    'Generated from `packages/auth/src/policy/matrix.ts` by `pnpm docs:permissions`. Do not edit by',
    'hand; CI fails when this file is stale.',
    '',
    '`can(actor, action, resource?, settings?)` in `@causedeck/auth` is the one permission decision.',
    'It is pure and denies by default; Postgres RLS is the backstop. ✓ means the role is allowed by',
    'the matrix, before the resource checks below.',
    '',
  ];
  for (const domain of Object.keys(ACTIONS) as ActionDomain[]) {
    lines.push(`## ${domain}`, '', ...table(domain), '');
  }
  lines.push(
    '## Settings and resource rules',
    '',
    '- `advocatesCanInvite` (default true): when false, advocates are denied `member.invite`',
    '  (workspace_settings.advocates_can_invite).',
    '- `advocatesCanReadAudit` (default true): when false, advocates are denied `audit.read`',
    '  (workspace_settings.advocates_can_read_audit).',
    '- Restricted matters: only users in `restricted.allowUserIds` may act on them, plus owners',
    '  while `ownersSeeRestrictedMatters` is true (the default;',
    '  workspace_settings.owners_see_restricted).',
    '- Juniors act on a matter only when it is assigned to them, shared with them (allow list) or',
    '  owned by them.',
    '',
    '## Deny reasons',
    '',
    ...DENY_REASONS.map((reason) => `- \`${reason}\`: ${REASON_NOTES[reason]}.`),
    '',
    '## Enforcement',
    '',
    'Every server action and `/v1` route authorizes: a server action goes through',
    '`workspaceAction` / `guard` (apps/web/lib) or calls `assertCan`; a `/v1` route lists',
    '`authorize(action)` in its `middleware`. The ESLint rule `causedeck/require-authorization`',
    '(packages/config/eslint) fails any that does not, unless it is annotated',
    '`// authz: public <reason>`, which reviewers check like any other exception.',
    '',
  );
  return lines.join('\n');
}
