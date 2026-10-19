// `GET /w/[slug]/billing/invoices/[id]/pdf` (#258, #29 part 7): download one SaaS invoice PDF.
// The slug must be a workspace the signed-in user belongs to (otherwise 404, signed out included,
// so nothing about a workspace leaks), and `invoices.read` (owners) is checked through `guard`.
// `openSaasInvoicePdf` finds the invoice in that workspace only (another workspace's invoice, a
// draft or an unrendered PDF is 404), records `billing.invoice_downloaded` and decrypts the stored
// object under the workspace DEK; the plaintext streams as an attachment, never cached or sniffed.
// The route serves stored bytes and never renders (no `@react-pdf/renderer` here).
import { openSaasInvoicePdf } from '@causedeck/core/billing';
import { db } from '@causedeck/db';
import { attachmentDisposition, EnvKeyProvider, type KeyProvider } from '@causedeck/storage';

import { serverEnv } from '../../../../../../../../lib/env.ts';
import { guard, guardResponse } from '../../../../../../../../lib/guard.ts';
import { objectStore } from '../../../../../../../../lib/storage.ts';
import { getWorkspaceContext } from '../../../../../../../../lib/workspace-loader.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ slug: string; id: string }>;
}

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 });

let keys: KeyProvider | undefined;
const keyProvider = (): KeyProvider => (keys ??= EnvKeyProvider.fromEnv(serverEnv()));

/** The client IP as the edge proxy reports it (first `X-Forwarded-For` hop). */
function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || undefined;
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { slug, id } = await params;
  const context = await getWorkspaceContext(slug);
  if (!context) return notFound();
  const workspaceId = context.workspace.id;

  let userId: string;
  try {
    ({ userId } = await guard({ workspaceId, action: 'invoices.read' }));
  } catch (error) {
    const response = guardResponse(error);
    if (response) return response;
    throw error;
  }

  const requestId = request.headers.get('x-request-id') ?? undefined;
  const userAgent = request.headers.get('user-agent') ?? undefined;
  const ip = clientIp(request);
  const pdf = await openSaasInvoicePdf(
    {
      db,
      store: objectStore(),
      keys: keyProvider(),
      workspaceId,
      userId,
      ...(requestId === undefined ? {} : { requestId }),
      ...(userAgent === undefined ? {} : { userAgent }),
      ...(ip === undefined ? {} : { ip }),
    },
    id,
  );
  if (pdf === null) return notFound();

  return new Response(pdf.stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': attachmentDisposition(pdf.filename),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
