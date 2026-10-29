// Test users and ids per seeded workspace (#105). Fictional, `.test` emails; the demo seed
// (packages/db/src/seed/demo/people.ts) and e2e seed own the real rows, these mirror their keys.
export interface PerfWorkspace {
  slug: string;
  ownerEmail: string;
}

/** The two demo workspaces plus the e2e workspace the Playwright suite signs in to. */
export const WORKSPACES: PerfWorkspace[] = [
  { slug: 'chennai-solo', ownerEmail: 'owner@chennai-solo.e2e.test' },
  { slug: 'demo-chennai-solo', ownerEmail: 'advocate.chennai-solo@demo.causedeck.test' },
  { slug: 'demo-bengaluru-chamber', ownerEmail: 'advocate.bengaluru-chamber@demo.causedeck.test' },
];

/** Worker n always uses the same workspace, so a run is reproducible. */
export function workspaceFor(vu: number): PerfWorkspace {
  return WORKSPACES[vu % WORKSPACES.length] as PerfWorkspace;
}

/** The workspace a virtual user must never reach: the next one in the list. */
export function otherWorkspace(own: PerfWorkspace): PerfWorkspace {
  const index = WORKSPACES.indexOf(own);
  return WORKSPACES[(index + 1) % WORKSPACES.length] as PerfWorkspace;
}
