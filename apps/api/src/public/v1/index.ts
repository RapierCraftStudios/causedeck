// The public developer API (#625, part 2 of #487): key-authenticated reads of case status, cause
// lists, orders and notices. Each route calls `requireScope` with its scope and stays inside one
// workspace; the paths are the `API_KEY_ROUTE_PREFIXES` the key middleware allows (#624).
import type { Database } from '@causedeck/db';

import { createRouter, type AppRouter } from '../../lib/openapi.ts';

import { casesRouter } from './cases.ts';
import { causeListsRouter } from './causelists.ts';
import { noticesRouter } from './notices.ts';
import { ordersRouter } from './orders.ts';

export function publicV1Router(db: Database): AppRouter {
  const router = createRouter();
  router.route('/', casesRouter(db));
  router.route('/', causeListsRouter(db));
  router.route('/', ordersRouter(db));
  router.route('/', noticesRouter(db));
  return router;
}
