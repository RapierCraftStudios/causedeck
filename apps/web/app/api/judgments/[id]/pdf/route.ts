// `/api/judgments/[id]/pdf` (#1191): "Download PDF" in the in-app judgment reader. The original PDF of
// a public judgment, served from our own object store, never the stored provenance URL. `GET` needs a
// signed-in session (the reader is a workspace page; the corpus is the same for every workspace),
// then core `getJudgmentPdfKey` returns the stored key only when the judgment is redacted, its title
// is not masked and it is not in a sensitive category (the original carries the unmasked names,
// D-053). The answer is a redirect to a 60-second presigned GET with `attachment` and
// `application/pdf`. 401 signed out, 400 bad id, 404 no stored or servable PDF.
import { getJudgmentPdfKey } from '@causedeck/core';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  attachmentDisposition,
  isCorpusObjectKey,
  type ObjectKey,
} from '@causedeck/storage';
import { z } from 'zod';

import { getSession } from '../../../../../lib/auth.ts';
import { objectStore } from '../../../../../lib/storage.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const json = (status: number, body: object) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const idSchema = z.uuid();

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return json(400, { error: 'invalid' });

  const key = await getJudgmentPdfKey(id.data);
  // Only corpus originals (`corpus/<sha256>.pdf`): never a workspace object.
  if (key === null || !isCorpusObjectKey(key)) return json(404, { error: 'not_found' });

  const signed = await objectStore().presignGet(key as ObjectKey, {
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    contentDisposition: attachmentDisposition(`${id.data}.pdf`),
    contentType: 'application/pdf',
  });
  return new Response(null, {
    status: 302,
    headers: { Location: signed.url, 'Cache-Control': 'no-store' },
  });
}
