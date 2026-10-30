// The synthetic dataset for the brief (#60): per workspace, one matter with a listing on `date`, an
// anchored confirmed order (three operative directions), open and closed obligations (one overdue),
// document pages the full-text context can find, a sensitive matter with its own listing, and a second
// matter whose pages share the search words (so a leak across matters would show). Fictional parties
// only; it writes through a transaction already scoped to the workspace and never runs in production.
import { createHash, randomUUID } from 'node:crypto';

import type { Transaction } from '../client.ts';
import { forum } from '../schema/court.ts';
import { hearing, listing, obligation, order } from '../schema/docket.ts';
import { anchor, document, documentPage } from '../schema/documents.ts';
import { matter } from '../schema/matter-graph.ts';
import { proceeding } from '../schema/proceedings.ts';

export interface BriefFixtureOptions {
  workspaceId: string;
  ownerMemberId: string;
  /** The listing date (`yyyy-mm-dd`). */
  date: string;
  /** The order date; defaults to ten days before `date`. */
  orderDate?: string;
}

export interface BriefFixture {
  matterId: string;
  proceedingId: string;
  listingId: string;
  documentId: string;
  orderId: string;
  anchorIds: string[];
  overdueObligationId: string;
  openObligationId: string;
  closedObligationId: string;
  sensitiveMatterId: string;
  sensitiveListingId: string;
  otherMatterId: string;
  otherDocumentId: string;
}

/** The operative directions of the fixture order, each anchored to this page text. */
export const BRIEF_FIXTURE_DIRECTIONS = [
  'Respondent shall file the counter affidavit on or before 20 October 2026.',
  'Petitioner may file a rejoinder within one week thereafter.',
  'List the matter for final hearing.',
] as const;

export const BRIEF_FIXTURE_SEARCH_WORD = 'counter';

async function makeDocument(tx: Transaction, workspaceId: string, matterId: string, text: string) {
  const key = randomUUID().replaceAll('-', '');
  const [doc] = await tx
    .insert(document)
    .values({
      workspaceId,
      kind: 'order',
      matterId,
      storageKey: `seed/brief/${key}.pdf`,
      sha256: createHash('sha256').update(key).digest('hex'),
    })
    .returning({ id: document.id });
  if (doc === undefined) throw new Error('brief fixture: document');
  await tx.insert(documentPage).values({ workspaceId, documentId: doc.id, pageNo: 1, text });
  return doc.id;
}

async function makeMatter(
  tx: Transaction,
  o: BriefFixtureOptions,
  forumId: string,
  title: string,
  sensitive: boolean,
) {
  const [m] = await tx
    .insert(matter)
    .values({
      workspaceId: o.workspaceId,
      title,
      practiceArea: 'writ',
      ownerMemberId: o.ownerMemberId,
      sensitive,
    })
    .returning({ id: matter.id });
  if (m === undefined) throw new Error('brief fixture: matter');
  const [p] = await tx
    .insert(proceeding)
    .values({
      workspaceId: o.workspaceId,
      matterId: m.id,
      forumId,
      caseTypeCode: 'WP',
      number: String(Math.floor(Math.random() * 9_000_000) + 100),
      year: 2026,
      sourceType: 'manual',
    })
    .returning({ id: proceeding.id });
  if (p === undefined) throw new Error('brief fixture: proceeding');
  const [l] = await tx
    .insert(listing)
    .values({
      workspaceId: o.workspaceId,
      proceedingId: p.id,
      listDate: o.date,
      listType: 'daily',
      stageRaw: 'FOR FINAL HEARING',
      stageNorm: 'final_hearing',
      sourceType: 'manual',
    })
    .returning({ id: listing.id });
  if (l === undefined) throw new Error('brief fixture: listing');
  return { matterId: m.id, proceedingId: p.id, listingId: l.id };
}

export async function insertBriefFixture(
  tx: Transaction,
  options: BriefFixtureOptions,
): Promise<BriefFixture> {
  const { workspaceId } = options;
  const tag = randomUUID().replaceAll('-', '').slice(0, 10);
  const [f] = await tx
    .insert(forum)
    .values({
      workspaceId,
      code: `seed.in.tn.madras-hc.brief${tag}`,
      court: 'High Court of Madras',
      seat: 'Chennai',
      jurisdictionKind: 'high_court' as const,
    })
    .returning({ id: forum.id });
  if (f === undefined) throw new Error('brief fixture: forum');

  const main = await makeMatter(tx, options, f.id, 'Asha Traders v. State of Fictionia', false);
  const documentId = await makeDocument(
    tx,
    workspaceId,
    main.matterId,
    BRIEF_FIXTURE_DIRECTIONS.join(' '),
  );
  const anchors = await tx
    .insert(anchor)
    .values(
      BRIEF_FIXTURE_DIRECTIONS.map((quote) => ({
        workspaceId,
        documentId,
        pageNo: 1,
        quote,
        kind: 'document' as const,
      })),
    )
    .returning({ id: anchor.id });
  const anchorIds = anchors.map((a) => a.id);
  const orderDate =
    options.orderDate ??
    new Date(Date.parse(`${options.date}T00:00:00Z`) - 10 * 86_400_000).toISOString().slice(0, 10);
  const [o] = await tx
    .insert(order)
    .values({
      workspaceId,
      proceedingId: main.proceedingId,
      documentId,
      orderDate,
      orderType: 'interim',
      operativeDirections: BRIEF_FIXTURE_DIRECTIONS.map((text, i) => ({
        text,
        anchorId: anchorIds[i] ?? '',
      })),
      sourceType: 'document',
      anchorId: anchorIds[0] ?? null,
      confidence: '0.950',
      confirmationState: 'confirmed',
    })
    .returning({ id: order.id });
  if (o === undefined) throw new Error('brief fixture: order');

  const base = {
    workspaceId,
    matterId: main.matterId,
    source: 'order_direction' as const,
    sourceOrderId: o.id,
    ownerMemberId: options.ownerMemberId,
    sourceType: 'document' as const,
    anchorId: anchorIds[0] ?? null,
    confirmationState: 'confirmed' as const,
  };
  const obligations = await tx
    .insert(obligation)
    .values([
      { ...base, description: 'counter not yet filed', dueDate: '2026-10-20' },
      { ...base, description: 'rejoinder to be filed', dueDate: '2026-12-31' },
      {
        ...base,
        description: 'vakalatnama filed',
        dueDate: '2026-09-01',
        status: 'done' as const,
        closedReasonType: 'lawyer_action' as const,
        closedBy: options.ownerMemberId,
        closedAt: new Date('2026-09-02T00:00:00Z'),
      },
    ])
    .returning({ id: obligation.id });
  const [overdue, open, closed] = obligations;
  if (overdue === undefined || open === undefined || closed === undefined) {
    throw new Error('brief fixture: obligations');
  }
  await tx.insert(hearing).values({
    workspaceId,
    listingId: main.listingId,
    heldOn: orderDate,
    outcome: 'adjourned',
    adjournmentReason: 'counter awaited',
    sourceType: 'manual',
  });

  const sensitive = await makeMatter(tx, options, f.id, 'Kavya Textiles v. Union of Utopia', true);
  const other = await makeMatter(tx, options, f.id, 'Meera Foods v. Sunrise Bank', false);
  const otherDocumentId = await makeDocument(
    tx,
    workspaceId,
    other.matterId,
    'The other matter: counter affidavit of the bank, not for this brief.',
  );
  return {
    ...main,
    documentId,
    orderId: o.id,
    anchorIds,
    overdueObligationId: overdue.id,
    openObligationId: open.id,
    closedObligationId: closed.id,
    sensitiveMatterId: sensitive.matterId,
    sensitiveListingId: sensitive.listingId,
    otherMatterId: other.matterId,
    otherDocumentId,
  };
}
