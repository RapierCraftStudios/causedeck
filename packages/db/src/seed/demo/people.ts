// People of the demo seed (#182): the demo workspace, its three members and the fictional opposing
// advocates. Parties and clients are per matter (matters.ts). Every name is invented and ends in
// "(fictional)"; emails use the reserved `.test` TLD and phones the unallocated 99999 00xxx range,
// so nothing here can reach a real person.
import { DEMO_WORKSPACE_SLUG } from '@causedeck/validators/workspace';

import type { WORKSPACE_ROLES } from '../../schema/auth.ts';

import { DEMO_WORKSPACE_ID, demoId, FICTIONAL_SUFFIX, ID_KIND } from './shared.ts';

/** `name` marked as fictional. */
export function fictional(name: string): string {
  return `${name}${FICTIONAL_SUFFIX}`;
}

export const DEMO_WORKSPACE = {
  id: DEMO_WORKSPACE_ID,
  slug: DEMO_WORKSPACE_SLUG,
  name: fictional('Kaveri Demo Chambers'),
  kind: 'chamber',
} as const;

/** The issue's three members; the lead advocate holds the workspace's `owner` role. */
export type DemoMemberKey = 'advocate' | 'junior' | 'clerk';

export interface DemoUser {
  key: DemoMemberKey;
  id: string;
  memberId: string;
  name: string;
  /** `<key>@demo.causedeck.test`: sign in by magic link (Mailpit in the local stack). */
  email: string;
  role: (typeof WORKSPACE_ROLES)[number];
}

function demoUser(n: number, key: DemoMemberKey, name: string, role: DemoUser['role']): DemoUser {
  return {
    key,
    id: demoId(ID_KIND.user, n),
    memberId: demoId(ID_KIND.member, n),
    name: fictional(name),
    email: `${key}@demo.causedeck.test`,
    role,
  };
}

export const DEMO_USERS: readonly DemoUser[] = [
  demoUser(1, 'advocate', 'Nila Arivazhagan', 'owner'),
  demoUser(2, 'junior', 'Kavin Mugilan', 'junior'),
  demoUser(3, 'clerk', 'Elango Ponmalar', 'clerk'),
];

export function demoMember(key: DemoMemberKey): DemoUser {
  const found = DEMO_USERS.find((u) => u.key === key);
  if (!found) throw new Error(`no demo user ${key}`);
  return found;
}

/** Opposing counsel, cycled across matters. */
export const OPPOSING_ADVOCATES: readonly string[] = [
  'Inba Thirunavu',
  'Hamsa Kanthiraj',
  'Maran Velpandi',
  'Prerana Hosmane',
  'Oviya Senthamizh',
].map(fictional);
