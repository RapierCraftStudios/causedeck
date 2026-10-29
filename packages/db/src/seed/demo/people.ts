// People of the demo seed (#182, #93): each demo workspace, its members and the fictional opposing
// advocates. Parties and clients are per matter (matters.ts). Every name is invented and ends in
// "(fictional)"; emails use the reserved `.test` TLD and phones the unallocated 99999 00xxx range,
// so nothing here can reach a real person.
import type { WORKSPACE_ROLES } from '../../schema/auth.ts';

import { demoId, FICTIONAL_SUFFIX, ID_KIND } from './shared.ts';
import {
  type DemoMemberKey,
  type DemoWorkspaceSpec,
  type DemoWorkspaceKey,
  DEMO_WORKSPACES,
} from './workspaces.ts';

export type { DemoMemberKey } from './workspaces.ts';

/** `name` marked as fictional. */
export function fictional(name: string): string {
  return `${name}${FICTIONAL_SUFFIX}`;
}

/** The workspace row (`organization`) of a demo workspace. */
export function demoOrganization(ws: DemoWorkspaceSpec) {
  return { id: ws.id, slug: ws.slug, name: fictional(ws.name), kind: ws.kind, isDemo: true };
}

export interface DemoUser {
  key: DemoMemberKey;
  workspace: DemoWorkspaceKey;
  id: string;
  memberId: string;
  name: string;
  /** `<key>.<workspace>@demo.causedeck.test`: sign in by magic link (Mailpit in the local stack). */
  email: string;
  role: (typeof WORKSPACE_ROLES)[number];
}

const MEMBER_ROLE: Record<DemoMemberKey, DemoUser['role']> = {
  advocate: 'owner',
  junior: 'junior',
  clerk: 'clerk',
};

const MEMBER_NAMES: Record<DemoWorkspaceKey, Record<DemoMemberKey, string>> = {
  'chennai-solo': {
    advocate: 'Nila Arivazhagan',
    junior: 'Kavin Mugilan',
    clerk: 'Elango Ponmalar',
  },
  'bengaluru-chamber': {
    advocate: 'Chandrika Tungabhadra',
    junior: 'Pranav Hosahalli',
    clerk: 'Ravi Kabinipura',
  },
};

/** The lead advocate holds the workspace's `owner` role. */
export function demoUsers(ws: DemoWorkspaceSpec): DemoUser[] {
  return ws.members.map((key, i) => ({
    key,
    workspace: ws.key,
    id: demoId(ID_KIND.user, i + 1, ws.index),
    memberId: demoId(ID_KIND.member, i + 1, ws.index),
    name: fictional(MEMBER_NAMES[ws.key][key]),
    email: `${key}.${ws.key}@demo.causedeck.test`,
    role: MEMBER_ROLE[key],
  }));
}

export const DEMO_USERS: readonly DemoUser[] = Object.values(DEMO_WORKSPACES).flatMap(demoUsers);

export function demoMember(ws: DemoWorkspaceSpec, key: DemoMemberKey): DemoUser {
  const found = demoUsers(ws).find((u) => u.key === key);
  if (!found) throw new Error(`no demo member ${key} in ${ws.key}`);
  return found;
}

/** Opposing counsel, cycled across matters. */
export const OPPOSING_ADVOCATES: Record<DemoWorkspaceKey, readonly string[]> = {
  'chennai-solo': [
    'Inba Thirunavu',
    'Maran Velpandi',
    'Oviya Senthamizh',
    'Tamilarasi Vendhan',
    'Selvan Thagadur',
  ].map(fictional),
  'bengaluru-chamber': [
    'Hamsa Kanthiraj',
    'Prerana Hosmane',
    'Manjula Sharavathi',
    'Girish Malnadu',
    'Sumana Hebbalu',
  ].map(fictional),
};
