// The stored transcript of a voice capture (#542): the transcript JSON is kept as a blob and a
// `note` document of the matter, and every span the structuring cites becomes a `transcript` anchor
// carrying the character range, the quote and the recording's millisecond bounds. Pure helpers
// (`citedSpans`, `anchorValues`) are separate from the one function that writes.
import { schema, type Transaction } from '@causedeck/db';
import type { Span, Transcript, ValidatedHearing } from '@causedeck/intelligence';
import { objectKey, type ObjectStore } from '@causedeck/storage';
import { createHash, randomUUID } from 'node:crypto';

import { createDocument, type MatterGraphDeps } from '../matter-graph/index.ts';

const { anchor, blob } = schema;

const spanKey = (span: Span): string => `${String(span.start)}:${String(span.end)}`;

/** Every distinct transcript span the validated reading rests on. */
export function citedSpans(structured: ValidatedHearing): Span[] {
  const all: (Span | undefined)[] = [
    structured.matterRef?.span,
    structured.outcome?.span,
    structured.adjournmentReason?.span,
    structured.nextDate?.span,
    structured.stageAfter?.span,
    ...structured.directions.map((d) => d.span),
    ...structured.tasks.map((t) => t.span),
  ];
  const seen = new Map<string, Span>();
  for (const span of all) if (span !== undefined) seen.set(spanKey(span), span);
  return [...seen.values()];
}

/** The anchor row values for one span: its quote and the moment of the recording it covers. */
export function anchorValues(transcript: Transcript, span: Span) {
  const overlapping = transcript.segments.filter(
    (s) => s.charStart < span.end && span.start < s.charEnd,
  );
  const startMs = overlapping.length === 0 ? 0 : Math.min(...overlapping.map((s) => s.startMs));
  const endMs =
    overlapping.length === 0
      ? (transcript.segments.at(-1)?.endMs ?? 0)
      : Math.max(...overlapping.map((s) => s.endMs));
  return {
    quote: transcript.text.slice(span.start, span.end).slice(0, schema.ANCHOR_QUOTE_MAX),
    charStart: span.start,
    charEnd: span.end,
    transcriptSpan: { startMs, endMs },
  };
}

export interface StoredTranscript {
  documentId: string;
  blobKey: string;
  /** Anchor id per span (`start:end`). */
  anchors: Map<string, string>;
}

/** Store the transcript, its document and one anchor per cited span, in the caller's transaction. */
export async function storeTranscript(
  deps: { store: ObjectStore; graph: MatterGraphDeps; now: Date },
  tx: Transaction,
  actor: { userId: string; workspaceId: string },
  matterId: string,
  transcript: Transcript,
  spans: readonly Span[],
): Promise<StoredTranscript> {
  const body = Buffer.from(JSON.stringify(transcript), 'utf8');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const blobId = randomUUID();
  const key = objectKey({ workspaceId: actor.workspaceId, kind: 'document', id: blobId }, deps.now);
  await deps.store.put({ key, body, contentType: 'application/json' });
  await tx.insert(blob).values({
    id: blobId,
    workspaceId: actor.workspaceId,
    key,
    kind: 'document',
    filename: 'voice-transcript.json',
    size: body.byteLength,
    sha256,
    mime: 'application/json',
    scanStatus: 'skipped',
    createdBy: actor.userId,
    createdAt: deps.now,
    finalizedAt: deps.now,
  });
  const document = await createDocument(deps.graph, actor, {
    matterId,
    kind: 'note',
    storageKey: key,
    sha256,
    language: transcript.language,
  });
  const anchors = new Map<string, string>();
  for (const span of spans) {
    const [row] = await tx
      .insert(anchor)
      .values({
        workspaceId: actor.workspaceId,
        documentId: document.id,
        pageNo: 1,
        kind: 'transcript',
        ...anchorValues(transcript, span),
      })
      .returning({ id: anchor.id });
    if (row === undefined) throw new Error('anchor insert returned no row');
    anchors.set(spanKey(span), row.id);
  }
  return { documentId: document.id, blobKey: key, anchors };
}

export { spanKey };
