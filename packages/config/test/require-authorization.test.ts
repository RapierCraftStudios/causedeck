import path from 'node:path';

import { ESLint, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { next } from '../eslint/next.js';
import { node } from '../eslint/node.js';
import { requireAuthorization } from '../eslint/rules/require-authorization.js';
import { fixturesDir } from './eslint-helpers';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: 'module' },
});

const ACTION_FILE = 'apps/web/app/(app)/thing/actions.ts';
const ROUTE_FILE = 'apps/api/src/routes/v1/things.ts';

const action = (code: string) => ({ code, filename: ACTION_FILE });
const route = (code: string) => ({ code, filename: ROUTE_FILE });

ruleTester.run('causedeck/require-authorization: server actions', requireAuthorization, {
  valid: [
    // workspaceAction always runs the guard, with or without a policy action.
    action(`'use server';
      const invite = workspaceAction(Input, async () => 1, { action: 'member.invite' });
      const list = workspaceAction(Input, async () => 1);
      export async function inviteAction(raw: unknown) { return invite(raw); }
      export async function listAction(raw: unknown) { return list(raw); }`),
    action(`'use server';
      export async function renameAction(actor: Actor) { assertCan(actor, 'workspace.rename'); }`),
    action(`'use server';
      export const archiveAction = async (input: Input) => {
        const { actor } = await guard({ workspaceId: input.workspaceId, action: 'matter.write' });
        return actor;
      };`),
    // Through a helper function declared in the module.
    action(`'use server';
      async function check(id: string) { await guard({ workspaceId: id }); }
      export async function helperAction(id: string) { await check(id); }`),
    action(`'use server';
      const setLocale = safeAction(Input, async () => 1);
      // authz: public — open to signed-out callers.
      export async function setLocaleAction(raw: unknown) { return setLocale(raw); }`),
    action(`'use server';
      /* authz: public */
      export async function pingAction() { return 1; }`),
    action(`'use server';
      const doIt = safeAction(Input, async () => 1);
      // authz: public — reviewed.
      async function exposed(raw: unknown) { return doIt(raw); }
      export { exposed };`),
    action(`'use server';
      export type Outcome = { ok: boolean };
      export interface View { id: string }
      async function helper() { return 1; }`),
    // Not a server-action module: plain exports are not actions.
    action(`export async function notAnAction() { return 1; }`),
    // 'use server' as text, not as the directive prologue.
    action(`const label = 'x';
      'use server';
      export async function notAnAction() { return label; }`),
    action(`export const marker = "'use server'";
      export async function notAnAction() { return marker; }`),
    // Inline server actions with their own directive.
    action(`export function Page() {
        async function save(id: string) { 'use server'; await guard({ workspaceId: id }); }
        return save;
      }`),
  ],
  invalid: [
    {
      ...action(`'use server';
        const create = safeAction(Input, async () => 1);
        export async function createAction(raw: unknown) { return create(raw); }`),
      errors: [{ messageId: 'missingServerAction', data: { name: 'createAction' } }],
    },
    {
      ...action(`'use server';
        export const deleteAction = async (id: string) => db.delete(id);`),
      errors: [{ messageId: 'missingServerAction', data: { name: 'deleteAction' } }],
    },
    {
      // A module-level helper that does not authorize does not count.
      ...action(`'use server';
        async function load(id: string) { return db.find(id); }
        export async function loadAction(id: string) { return load(id); }`),
      errors: [{ messageId: 'missingServerAction', data: { name: 'loadAction' } }],
    },
    {
      ...action(`'use server';
        // authz: todo
        export async function laterAction() { return 1; }`),
      errors: [{ messageId: 'missingServerAction', data: { name: 'laterAction' } }],
    },
    {
      ...action(`'use server';
        const guarded = workspaceAction(Input, async () => 1);
        async function open() { return 1; }
        export async function guardedAction(raw: unknown) { return guarded(raw); }
        export { open };`),
      errors: [{ messageId: 'missingServerAction', data: { name: 'open' } }],
    },
    {
      ...action(`export function Page() {
          async function save(id: string) { 'use server'; await db.save(id); }
          return save;
        }`),
      errors: [{ messageId: 'missingServerAction', data: { name: 'save' } }],
    },
  ],
});

ruleTester.run('causedeck/require-authorization: /v1 routes', requireAuthorization, {
  valid: [
    route(`export function thingRoute(db: Database) {
        return defineRoute({
          method: 'get',
          path: '/things',
          middleware: [requireWorkspace(db), authorize('matter.read')],
          responses: {},
        });
      }`),
    route(`// authz: public — authenticated, caller-scoped.
      export const meRoute = defineRoute({ method: 'get', path: '/me', responses: {} });`),
    route(`// authz: public — the plan catalogue.
      export function plansRoute() {
        return createRoute({ method: 'get', path: '/plans', responses: {} });
      }`),
    // Outside routes/v1 the route half of the rule does not apply.
    {
      code: `export const hook = defineRoute({ method: 'post', path: '/hook', responses: {} });`,
      filename: 'apps/api/src/routes/webhooks/razorpay.ts',
    },
  ],
  invalid: [
    {
      ...route(
        `export const thingsRoute = defineRoute({ method: 'get', path: '/things', responses: {} });`,
      ),
      errors: [{ messageId: 'missingRoute' }],
    },
    {
      ...route(`export function subscriptionRoute(db: Database) {
          return defineRoute({
            method: 'get',
            path: '/billing/subscription',
            middleware: [requireWorkspace(db)],
            responses: {},
          });
        }`),
      errors: [{ messageId: 'missingRoute' }],
    },
    {
      ...route(`// authz: todo
        export const laterRoute = createRoute({ method: 'get', path: '/later', responses: {} });`),
      errors: [{ messageId: 'missingRoute' }],
    },
  ],
});

describe('causedeck/require-authorization wiring', () => {
  const cwd = path.join(fixturesDir, 'rules');

  async function severity(config: unknown[], file: string): Promise<unknown> {
    const eslint = new ESLint({
      cwd,
      overrideConfigFile: true,
      overrideConfig: config as ESLint.Options['overrideConfig'],
    });
    const resolved = (await eslint.calculateConfigForFile(path.join(cwd, file))) as {
      rules?: Record<string, unknown[]>;
    };
    return resolved.rules?.['causedeck/require-authorization']?.[0];
  }

  it('is an error for server actions in the Next.js config', async () => {
    expect(await severity(next, 'app/(app)/thing/actions.ts')).toBe(2);
  });

  it('is an error for /v1 routes in the Node config, and off elsewhere', async () => {
    expect(await severity(node, 'src/routes/v1/things.ts')).toBe(2);
    expect(await severity(node, 'apps/api/src/routes/v1/x.ts')).toBe(2);
    expect(await severity(node, 'src/jobs/thing.ts')).toBeUndefined();
  });
});
