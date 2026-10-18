// Shared Hono env, the router factory and the OpenAPI security rule (#14): every `/v1` route either
// declares `security` (and gets `requireAuth`) or is explicitly `public: true` (webhooks, which
// verify signatures instead). `assertRouteSecurity` is the guard the unit tests run.
import type { SessionUser } from '@causedeck/auth';
import type { Transaction } from '@causedeck/db';
import { OpenAPIHono, type RouteConfig } from '@hono/zod-openapi';
import { PROBLEM_CONTENT_TYPE, ProblemSchema } from '@causedeck/validators/api';
import type { Context, MiddlewareHandler } from 'hono';

import { fieldErrors, UnauthenticatedError, ValidationError } from '../errors.ts';

export interface Principal {
  user: SessionUser;
  /** How the caller authenticated; CSRF checks apply to `cookie` only. */
  via: 'cookie' | 'bearer';
}

export type WithWorkspace = <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;

export interface AppVariables {
  requestId: string;
  principal: Principal | null;
  workspaceId: string;
  withWorkspace: WithWorkspace;
}

export interface AppEnv {
  Variables: AppVariables;
}

export type AppRouter = OpenAPIHono<AppEnv>;

export const API_VERSION = 'v1';
export const OPENAPI_INFO = { title: 'CauseDeck API', version: '1.0.0' } as const;

export const SECURITY_SCHEMES = {
  sessionCookie: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' },
  bearerToken: { type: 'http', scheme: 'bearer' },
} as const;

/** Either a session cookie or an API bearer token. */
export const AUTHENTICATED: Record<string, string[]>[] = [
  { sessionCookie: [] },
  { bearerToken: [] },
];

/** Marker extension on public routes; the guard accepts it instead of `security`. */
export const PUBLIC_EXTENSION = 'x-public';

/** A router whose zod failures become 422 problems with field-level `errors[]`. */
export function createRouter(): AppRouter {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        const target =
          result.target === 'json' || result.target === 'form' ? 'body' : result.target;
        throw new ValidationError(fieldErrors(target, result.error.issues));
      }
    },
  });
}

/** Route middleware: 401 unless `resolvePrincipal` found a caller. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('principal') === null) throw new UnauthenticatedError();
  await next();
};

type Middleware = MiddlewareHandler<AppEnv>;

function asArray(middleware: RouteConfig['middleware']): Middleware[] {
  if (middleware === undefined) return [];
  return (Array.isArray(middleware) ? middleware : [middleware]) as Middleware[];
}

/**
 * `createRoute` with the security rule built in: authenticated by default (OpenAPI `security` plus
 * `requireAuth` before validation), or `public: true` for routes that authenticate otherwise.
 */
export function defineRoute<const R extends RouteConfig>(config: R & { public?: true }): R {
  const { public: isPublic, middleware, ...rest } = config;
  const security = isPublic
    ? { security: [], [PUBLIC_EXTENSION]: true, middleware: asArray(middleware) }
    : { security: AUTHENTICATED, middleware: [requireAuth, ...asArray(middleware)] };
  // The added `requireAuth` uses the router's own env, so the route's static type is unchanged.
  return { ...rest, ...security } as unknown as R;
}

export interface RouteSecurityViolation {
  method: string;
  path: string;
}

const isVersioned = (path: string) =>
  path === `/${API_VERSION}` || path.startsWith(`/${API_VERSION}/`);

/** OpenAPI `{param}` → Hono `:param`. */
const toHonoPath = (path: string) => path.replaceAll(/\{(\w+)\}/g, ':$1');

/**
 * `/v1` routes that neither declare `security` nor are marked public, plus handlers registered
 * with plain `get`/`post` (not in the OpenAPI registry, so they carry no annotation at all).
 */
export function assertRouteSecurity(app: AppRouter): RouteSecurityViolation[] {
  const violations: RouteSecurityViolation[] = [];
  const documented = new Set<string>();
  for (const definition of app.openAPIRegistry.definitions) {
    if (definition.type !== 'route') continue;
    const { route } = definition;
    if (!isVersioned(route.path)) continue;
    documented.add(`${route.method.toUpperCase()} ${toHonoPath(route.path)}`);
    const extensions = route as unknown as Record<string, unknown>;
    const isPublic = extensions[PUBLIC_EXTENSION] === true;
    const secured = Array.isArray(route.security) && route.security.length > 0;
    if (!secured && !isPublic) violations.push({ method: route.method, path: route.path });
  }
  for (const { method, path } of app.routes) {
    // `ALL` entries are middleware (`use`), not endpoints.
    if (method === 'ALL' || !isVersioned(path)) continue;
    if (!documented.has(`${method} ${path}`)) {
      violations.push({ method: method.toLowerCase(), path });
    }
  }
  return violations;
}

/** Register the security schemes the routes reference. Call once per app. */
export function registerSecuritySchemes(app: AppRouter): void {
  app.openAPIRegistry.registerComponent('securitySchemes', 'sessionCookie', {
    ...SECURITY_SCHEMES.sessionCookie,
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerToken', {
    ...SECURITY_SCHEMES.bearerToken,
  });
}

/** The OpenAPI 3.1 document for the app (served at `/openapi.json`, exported to openapi/v1.json). */
export function buildOpenApiDocument(app: AppRouter) {
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      ...OPENAPI_INFO,
      description:
        'Public REST API. Errors are RFC 9457 problem+json; see docs/engineering/api.md.',
    },
    servers: [{ url: '/' }],
  });
}

/** The authenticated caller; only valid behind `requireAuth`. */
export function principalOf(c: Context<AppEnv>): Principal {
  const principal = c.get('principal');
  if (principal === null) throw new UnauthenticatedError();
  return principal;
}

const PROBLEM_DESCRIPTIONS: Record<number, string> = {
  401: 'Not authenticated',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  422: 'Validation failed',
  429: 'Rate limited',
};

/** OpenAPI `responses` entries for problem+json errors. */
export function problemResponses<const S extends number>(...statuses: S[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description: PROBLEM_DESCRIPTIONS[status] ?? 'Error',
        content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemSchema } },
      },
    ]),
  ) as unknown as Record<
    S,
    { description: string; content: Record<string, { schema: typeof ProblemSchema }> }
  >;
}
