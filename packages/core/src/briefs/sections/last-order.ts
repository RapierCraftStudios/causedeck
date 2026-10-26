// The last-order section (#60): 2-3 lines from the latest order's operative directions, each with the
// page-anchored link. An unconfirmed extraction is labelled 'Unconfirmed' and still anchored. AI
// compression (the gateway's `summarise` task) runs only on the anchored directions, never on a
// sensitive matter, and its text is kept only when every date in it appears in the anchored source
// text; otherwise (or on any gateway failure) the deterministic lines stand.
import { schema } from '@causedeck/db';
import type { BriefLine } from '@causedeck/validators';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { createCoreAiGateway } from '../../ai/index.ts';
import { provenanceOf, withProvenance, type BriefScope, type ListingContext } from '../scope.ts';

export const MAX_ORDER_LINES = 3;

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const DATE_PATTERNS = [
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})[a-z]*\\.?(?:,?\\s+\\d{4})?`, 'gi'),
];

const norm = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** The dates written in `text`, normalised. */
export function datesIn(text: string): string[] {
  return DATE_PATTERNS.flatMap((re) => text.match(re) ?? []).map(norm);
}

/** True when every date in `text` appears in `source` (no date the anchored text does not carry). */
export function datesPresentIn(text: string, source: string): boolean {
  const haystack = norm(source);
  return datesIn(text).every((d) => haystack.includes(d));
}

export interface LastOrderResult {
  lines: BriefLine[];
  aiUsed: boolean;
}

export async function lastOrderSection(
  scope: BriefScope,
  listing: ListingContext,
  compress: boolean,
): Promise<LastOrderResult> {
  const { tx, actor } = scope;
  const [order] = await tx
    .select()
    .from(schema.order)
    .where(
      and(
        eq(schema.order.workspaceId, actor.workspaceId),
        eq(schema.order.proceedingId, listing.proceedingId),
      ),
    )
    .orderBy(desc(schema.order.orderDate), desc(schema.order.createdAt))
    .limit(1);
  if (order === undefined) return { lines: [], aiUsed: false };

  const directions = order.operativeDirections.slice(0, MAX_ORDER_LINES);
  const anchorIds = directions.map((d) => d.anchorId);
  const anchors =
    anchorIds.length === 0
      ? []
      : await tx
          .select()
          .from(schema.anchor)
          .where(
            and(
              eq(schema.anchor.workspaceId, actor.workspaceId),
              inArray(schema.anchor.id, anchorIds),
            ),
          );
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const unconfirmed = order.confirmationState === 'proposed';
  const label = unconfirmed ? 'Unconfirmed' : null;

  const lines: BriefLine[] = [];
  for (const direction of directions) {
    const anchor = byId.get(direction.anchorId);
    if (anchor === undefined) continue;
    // A direction whose date is not in the anchored text shows the anchored quote instead.
    const text = datesPresentIn(direction.text, anchor.quote) ? direction.text : anchor.quote;
    lines.push({
      text,
      label,
      page_no: anchor.pageNo,
      quote: anchor.quote,
      ...provenanceOf({ ...order, anchorId: anchor.id }),
    });
  }
  const deterministic = withProvenance(lines);
  if (!compress || listing.sensitive || deterministic.length < 2) {
    return { lines: deterministic, aiUsed: false };
  }

  try {
    const gateway = scope.deps.gateway ?? createCoreAiGateway(tx, { now: () => scope.now });
    const result = await gateway.run<{ summary: string }>(
      'summarise',
      {
        text: deterministic.map((l) => l.text).join('\n'),
        maxSentences: MAX_ORDER_LINES,
      },
      {
        workspaceId: actor.workspaceId,
        matterId: listing.matterId,
        userId: actor.userId,
        purpose: 'brief.last_order',
        idempotencyKey: `brief.last_order:${order.id}:${String(order.updatedAt.getTime())}`,
      },
    );
    const sentences = result.output.summary
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, MAX_ORDER_LINES);
    const source = deterministic.map((l) => l.quote ?? '').join(' ');
    const first = deterministic[0];
    if (
      first === undefined ||
      sentences.length < 2 ||
      !sentences.every((s) => datesPresentIn(s, source))
    ) {
      return { lines: deterministic, aiUsed: false };
    }
    // The compressed lines cite the order's first anchored direction and stay proposals.
    return {
      lines: sentences.map((text) => ({
        ...first,
        text,
        source_type: 'ai' as const,
        confirmation_state: 'proposed' as const,
        label: 'Unconfirmed',
      })),
      aiUsed: true,
    };
  } catch {
    return { lines: deterministic, aiUsed: false };
  }
}
