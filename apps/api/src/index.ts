/** Hono REST API (/v1), webhooks, OpenAPI docs (#14). `src/server.ts` is the process entry. */
export const appName: string = '@causedeck/api';

export { createApp, DOCS_PATH, OPENAPI_PATH, type AppDeps } from './app.ts';
export * from './errors.ts';
export {
  assertRouteSecurity,
  buildOpenApiDocument,
  createRouter,
  defineRoute,
  type AppEnv,
  type AppRouter,
  type Principal,
} from './lib/openapi.ts';
export type { BearerResolver } from './middleware/auth.ts';
