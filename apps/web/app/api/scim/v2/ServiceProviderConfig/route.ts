// `GET /api/scim/v2/ServiceProviderConfig` (#684, part of #508): the SCIM discovery document. It is
// authenticated like the Users routes so it does not reveal that SCIM is enabled to anyone else.
import { handleScim, scimServiceProviderConfig } from '@causedeck/core/provisioning';
import { db } from '@causedeck/core/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const { status, body } = await handleScim(db, request.headers.get('authorization'), () =>
    Promise.resolve(scimServiceProviderConfig()),
  );
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/scim+json', 'cache-control': 'no-store' },
  });
}
