// Demo sign-in (#93): opens a session for an ephemeral visitor of a demo workspace, no email or
// password. The visitor is created by the app (`@causedeck/core/demo` `enterDemo`) and handed in
// through `DemoEntry`, so this package imports no domain code. The session ends after the lifetime
// `enter` returns (4 hours) and is created `dontRememberMe`: Better Auth then neither refreshes it
// (no sliding extension) nor keeps the cookie past the browser session. Registered only when the
// app passes `demo`, and rate limited by IP (see `DEMO_SIGN_IN_LIMIT`).
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

export const DEMO_SIGN_IN_PATH = '/demo/sign-in';

/** Ten new demo visitors per IP per hour. */
export const DEMO_SIGN_IN_LIMIT = { windowSeconds: 60 * 60, max: 10 } as const;

export interface DemoVisitor {
  userId: string;
  workspaceId: string;
  slug: string;
  /** When the session must end. */
  expiresAt: Date;
}

export interface DemoEntry {
  /** Create the visitor of `workspace`; throws an error with a `code` (`NOT_FOUND`, `VALIDATION`, `RATE_LIMITED`) when it cannot. */
  enter(workspace: string): Promise<DemoVisitor>;
}

const bodySchema = z.object({ workspace: z.string().min(1).max(40) });

function toApiError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'NOT_FOUND':
      return new APIError('NOT_FOUND', { message: 'This demo is not available right now' });
    case 'VALIDATION':
      return new APIError('BAD_REQUEST', { message: 'Unknown demo workspace' });
    case 'RATE_LIMITED':
      return new APIError('TOO_MANY_REQUESTS', {
        message: 'Too many requests. Please try again later.',
      });
    default:
      return error;
  }
}

export function demoSignIn(entry: DemoEntry) {
  return {
    id: 'demo-sign-in',
    endpoints: {
      demoSignIn: createAuthEndpoint(
        DEMO_SIGN_IN_PATH,
        { method: 'POST', body: bodySchema },
        async (ctx) => {
          let visitor: DemoVisitor;
          try {
            visitor = await entry.enter(ctx.body.workspace);
          } catch (error) {
            throw toApiError(error);
          }
          const { internalAdapter } = ctx.context;
          const user = await internalAdapter.findUserById(visitor.userId);
          if (!user) throw new APIError('NOT_FOUND', { message: 'This demo is not available' });
          // `overrideAll` keeps `expiresAt` at the demo lifetime instead of the 1-day default.
          const session = await internalAdapter.createSession(
            visitor.userId,
            true,
            { expiresAt: visitor.expiresAt, activeOrganizationId: visitor.workspaceId },
            true,
          );
          await setSessionCookie(ctx, { session, user }, true);
          return ctx.json({ slug: visitor.slug, expiresAt: visitor.expiresAt.toISOString() });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
