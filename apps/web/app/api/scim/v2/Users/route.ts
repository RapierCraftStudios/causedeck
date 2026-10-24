// `GET` and `POST /api/scim/v2/Users` (#684, part of #508): SCIM v2 list and create. The bearer
// SCIM token (`scim_token`, issued by an owner) is the only credential; `handleScim` resolves its
// workspace, so a bad token is a 401 SCIM error and nothing runs. Responses are `application/scim+json`.
import { createScimUser, handleScim, listScimUsers, scimError } from '@causedeck/core/provisioning';
import { db } from '@causedeck/core/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const respond = ({ status, body }: { status: number; body?: unknown }) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/scim+json', 'cache-control': 'no-store' },
  });

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const number = (name: string) => (params.has(name) ? Number(params.get(name)) : undefined);
  return respond(
    await handleScim(db, request.headers.get('authorization'), (tx, identity) =>
      listScimUsers(tx, identity, {
        filter: params.get('filter'),
        startIndex: number('startIndex'),
        count: number('count'),
      }),
    ),
  );
}

export async function POST(request: Request): Promise<Response> {
  const { installBillingEntitlements } = await import('@causedeck/core/billing');
  installBillingEntitlements();
  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined) return respond(scimError(400, 'Invalid JSON body', 'invalidSyntax'));
  return respond(
    await handleScim(db, request.headers.get('authorization'), (tx, identity) =>
      createScimUser(tx, identity, body),
    ),
  );
}
