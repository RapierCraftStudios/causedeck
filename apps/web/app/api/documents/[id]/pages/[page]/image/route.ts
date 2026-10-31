// `/api/documents/[id]/pages/[page]/image` (#489): the stored image of one page of a matter's
// document, for the source preview in the inbox and `DocumentPreviewSheet`. `GET ?workspaceId=`
// checks the session and workspace membership (`guard`), then core `openDocumentPageImageFor`
// applies the document rules (a matter the member may read, `document.read`) and decrypts the
// image with the workspace key, streamed and never buffered. The image is private: no shared cache,
// no sniffing, never inline HTML.
// 401 signed out, 403 forbidden, 404 not a member, no such document or page or no stored image,
// 400 bad input.
import { openDocumentPageImageFor } from '@causedeck/core/runtime';
import { WorkspaceError } from '@causedeck/core/workspaces';
import { EnvKeyProvider, type KeyProvider } from '@causedeck/storage';
import { z } from 'zod';

import { getSession } from '../../../../../../../lib/auth.ts';
import { serverEnv } from '../../../../../../../lib/env.ts';
import { guard, guardResponse } from '../../../../../../../lib/guard.ts';
import { objectStore } from '../../../../../../../lib/storage.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string; page: string }>;
}

const params = z.object({
  id: z.uuid(),
  page: z.string().regex(/^\d{1,5}$/),
});
const query = z.object({ workspaceId: z.uuid() });

const json = (status: number, body: object) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

let keys: KeyProvider | undefined;
const keyProvider = (): KeyProvider => (keys ??= EnvKeyProvider.fromEnv(serverEnv()));

/** A web stream over an async iterable, pulled one chunk at a time (no buffering). */
function toStream(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });
  const raw = params.safeParse(await context.params);
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  const pageNo = raw.success ? Number(raw.data.page) : 0;
  if (!raw.success || !parsed.success || pageNo < 1 || pageNo > 10_000) {
    return json(400, { error: 'invalid' });
  }
  const { workspaceId } = parsed.data;

  let userId: string;
  try {
    ({ userId } = await guard({ workspaceId, session }));
  } catch (error) {
    const response = guardResponse(error);
    if (response) return response;
    throw error;
  }

  try {
    const image = await openDocumentPageImageFor(
      { workspaceId, userId },
      { documentId: raw.data.id, pageNo },
      { store: objectStore(), keys: keyProvider() },
    );
    return new Response(toStream(image.body), {
      status: 200,
      headers: {
        'Content-Type': image.mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceError) {
      if (error.code === 'FORBIDDEN') return json(403, { error: 'forbidden' });
      if (error.code === 'VALIDATION') return json(400, { error: 'invalid' });
      return json(404, { error: 'not_found' });
    }
    throw error;
  }
}
