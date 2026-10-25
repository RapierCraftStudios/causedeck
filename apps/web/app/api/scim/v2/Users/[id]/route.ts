// `GET`, `PATCH`, `PUT` and `DELETE /api/scim/v2/Users/{id}` (#684, part of #508). `id` is the
// user id of a member of the token's workspace; any other id is a 404. See `../route.ts`.
import {
  deleteScimUser,
  getScimUser,
  handleScim,
  patchScimUser,
  replaceScimUser,
  scimError,
  type ScimResult,
} from '@causedeck/core/provisioning';
import { db } from '@causedeck/core/runtime';
import type { Transaction } from '@causedeck/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };
type Identity = { tokenId: string; workspaceId: string };

const respond = ({ status, body }: ScimResult) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/scim+json', 'cache-control': 'no-store' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function serve(
  request: Request,
  { params }: Context,
  run: (tx: Transaction, identity: Identity, id: string) => Promise<ScimResult>,
): Promise<Response> {
  const { id } = await params;
  return respond(
    await handleScim(db, request.headers.get('authorization'), (tx, identity) =>
      UUID.test(id) ? run(tx, identity, id) : Promise.resolve(scimError(404, 'User not found')),
    ),
  );
}

async function withBody(
  request: Request,
  context: Context,
  run: (tx: Transaction, identity: Identity, id: string, body: unknown) => Promise<ScimResult>,
): Promise<Response> {
  const { installBillingEntitlements } = await import('@causedeck/core/billing');
  installBillingEntitlements();
  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined) return respond(scimError(400, 'Invalid JSON body', 'invalidSyntax'));
  return serve(request, context, (tx, identity, id) => run(tx, identity, id, body));
}

export const GET = (request: Request, context: Context) =>
  serve(request, context, (tx, identity, id) => getScimUser(tx, identity, id));

export const PATCH = (request: Request, context: Context) =>
  withBody(request, context, (tx, identity, id, body) => patchScimUser(tx, identity, id, body));

export const PUT = (request: Request, context: Context) =>
  withBody(request, context, (tx, identity, id, body) => replaceScimUser(tx, identity, id, body));

export const DELETE = (request: Request, context: Context) =>
  serve(request, context, (tx, identity, id) => deleteScimUser(tx, identity, id));
