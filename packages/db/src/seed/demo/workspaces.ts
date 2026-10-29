// The two demo workspaces (#93): a Chennai solo advocate before the Madras High Court and a
// Bengaluru chamber before the High Court of Karnataka and the Bengaluru A0 forums (City Civil
// Court, Mayo Hall). Each has a fixed id, a reserved `demo-` slug and its own members; nothing is
// shared between them, so no row of one references the other (no cross-workspace foreign keys).
import type { DemoForumKey } from './courts.ts';
import { demoId, ID_KIND } from './shared.ts';

export const DEMO_WORKSPACE_KEYS = ['chennai-solo', 'bengaluru-chamber'] as const;
export type DemoWorkspaceKey = (typeof DEMO_WORKSPACE_KEYS)[number];

export function isDemoWorkspaceKey(value: string): value is DemoWorkspaceKey {
  return (DEMO_WORKSPACE_KEYS as readonly string[]).includes(value);
}

export type DemoMemberKey = 'advocate' | 'junior' | 'clerk';

export interface DemoWorkspaceSpec {
  key: DemoWorkspaceKey;
  /** Position in `DEMO_WORKSPACE_KEYS`; part of every row id. */
  index: number;
  /** `organization.id`. */
  id: string;
  /** Reserved (`demo-` prefix): no real workspace can take it. */
  slug: string;
  /** Without the fictional suffix (people.ts adds it). */
  name: string;
  kind: 'solo' | 'chamber';
  practiceCity: string;
  /** One-line description for the entry card. */
  blurb: string;
  forums: readonly DemoForumKey[];
  members: readonly DemoMemberKey[];
  /** Seed of the PRNG that generates the extra matters, parties and dates. */
  prngSeed: number;
}

export const DEMO_WORKSPACES: Record<DemoWorkspaceKey, DemoWorkspaceSpec> = {
  'chennai-solo': {
    key: 'chennai-solo',
    index: 0,
    id: demoId(ID_KIND.workspace, 1, 0),
    slug: 'demo-chennai-solo',
    name: 'Nila Arivazhagan, Advocate',
    kind: 'solo',
    practiceCity: 'Chennai',
    blurb: 'A solo advocate on the Madras High Court: writs, bail, suits and appeals.',
    forums: ['mhc'],
    members: ['advocate', 'clerk'],
    prngSeed: 0x93c0ffee,
  },
  'bengaluru-chamber': {
    key: 'bengaluru-chamber',
    index: 1,
    id: demoId(ID_KIND.workspace, 1, 1),
    slug: 'demo-bengaluru-chamber',
    name: 'Kaveri Demo Chambers',
    kind: 'chamber',
    practiceCity: 'Bengaluru',
    blurb: 'A chamber with a junior and a clerk: High Court of Karnataka and the city courts.',
    forums: ['khc', 'ccc', 'mayo'],
    members: ['advocate', 'junior', 'clerk'],
    prngSeed: 0x93b3a1a7,
  },
};

export function demoWorkspace(key: DemoWorkspaceKey): DemoWorkspaceSpec {
  return DEMO_WORKSPACES[key];
}

/** The workspace whose id or slug is `value`, if it is one of the demo workspaces. */
export function demoWorkspaceBySlug(slug: string): DemoWorkspaceSpec | undefined {
  return Object.values(DEMO_WORKSPACES).find((w) => w.slug === slug.toLowerCase());
}
