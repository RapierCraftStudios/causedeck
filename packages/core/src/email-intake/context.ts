// The email-intake domain's call context (#54 part 2). `authorize` is the `assertCan` seam, as in
// the capture domain; `domain` is the host the intake addresses live at. Services run inside
// `withWorkspace`, so FORCE row-level security keeps every row in its own workspace.
import type { Queryable } from '@causedeck/db';

/** Every email-intake service needs `workspace.manage`, like the capture channels it switches on. */
export type EmailIntakeAction = 'workspace.manage';

export interface EmailIntakeCtx {
  db: Queryable;
  workspaceId: string;
  userId: string;
  /** The host after the `@` of every intake address. */
  domain: string;
  authorize(action: EmailIntakeAction): void | Promise<void>;
  now?: () => Date;
  /** Request metadata for audit rows. */
  requestId?: string;
  userAgent?: string;
  ip?: string;
}
