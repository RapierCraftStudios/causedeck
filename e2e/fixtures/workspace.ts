// Seeded workspaces and users (packages/db/src/seed/e2e.ts) and navigation into a workspace.
import type { Page, Response } from '@playwright/test';

export {
  E2E_USERS,
  E2E_WORKSPACE_SLUGS,
  E2E_WORKSPACES,
  e2eUser,
  type E2eRole,
  type E2eUser,
  type E2eWorkspaceSlug,
} from '@causedeck/db/seed/e2e';

/** Open `/w/<slug>/<path>` (default `today`). */
export function gotoWorkspace(page: Page, slug: string, path = 'today'): Promise<Response | null> {
  return page.goto(`/w/${slug}/${path}`);
}
