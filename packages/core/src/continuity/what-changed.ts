// What changed since the viewer last opened a matter (#71). `recordView` keeps one `matter_view` row
// per member and matter, written at most once every 30 s; `whatChangedSince` is a derived view over
// the docket (orders, hearings, listings, next dates, obligation events, documents) in chronological
// day groups, each line with its provenance and, where the source records one, its actor;
// `changesForViewer` reads the marker, summarises since it and records the view. The output is built
// from docket rows only: no strategy note, matter memory or court note can appear in it, for any role.
import { schema } from '@causedeck/db';
import {
  ChangeSummary,
  RecordViewInput,
  VIEW_DEBOUNCE_SECONDS,
  ViewMarker,
  WhatChangedInput,
  type BriefLine,
  type ChangeItem,
  type ChangeKind,
} from '@causedeck/validators';
import { and, eq, gt, inArray } from 'drizzle-orm';

import {
  audit,
  documentLine,
  inContinuityScope,
  loadMatter,
  parseInput,
  provenanceOf,
  requireAction,
  shortDate,
  withProvenance,
  type ContinuityActor,
  type ContinuityDeps,
  type ContinuityScope,
} from './scope.ts';

const DAY_MS = 86_400_000;

/** Record that the actor opened the matter now (needs `matter.read`); a repeat inside 30 s writes nothing. */
export async function recordView(
  deps: ContinuityDeps,
  actor: ContinuityActor,
  input: unknown,
): Promise<ViewMarker> {
  const { matterId } = parseInput(RecordViewInput, input);
  return inContinuityScope(deps, actor, (scope) => writeView(scope, matterId));
}

async function readView(scope: ContinuityScope, matterId: string): Promise<Date | null> {
  const [row] = await scope.tx
    .select({ viewedAt: schema.matterView.viewedAt })
    .from(schema.matterView)
    .where(
      and(
        eq(schema.matterView.workspaceId, scope.actor.workspaceId),
        eq(schema.matterView.matterId, matterId),
        eq(schema.matterView.memberId, scope.memberId),
      ),
    )
    .limit(1);
  return row?.viewedAt ?? null;
}

async function writeView(scope: ContinuityScope, matterId: string) {
  await requireAction(scope, 'matter.read', 'You cannot read this matter');
  await loadMatter(scope, matterId);
  const previous = await readView(scope, matterId);
  const fresh =
    previous !== null && scope.now.getTime() - previous.getTime() < VIEW_DEBOUNCE_SECONDS * 1000;
  if (!fresh) {
    await scope.tx
      .insert(schema.matterView)
      .values({
        workspaceId: scope.actor.workspaceId,
        matterId,
        memberId: scope.memberId,
        viewedAt: scope.now,
      })
      .onConflictDoUpdate({
        target: [
          schema.matterView.workspaceId,
          schema.matterView.matterId,
          schema.matterView.memberId,
        ],
        set: { viewedAt: scope.now },
      });
  }
  return ViewMarker.parse({
    matter_id: matterId,
    previous_viewed_at: previous?.toISOString() ?? null,
    viewed_at: (fresh && previous !== null ? previous : scope.now).toISOString(),
    recorded: !fresh,
  });
}

interface Raw {
  kind: ChangeKind;
  at: Date;
  actor: string | null;
  line: BriefLine;
}

async function collect(scope: ContinuityScope, matterId: string, since: Date): Promise<Raw[]> {
  const { tx, actor } = scope;
  const ws = actor.workspaceId;
  const proceedings = (
    await tx
      .select({ id: schema.proceeding.id })
      .from(schema.proceeding)
      .where(and(eq(schema.proceeding.workspaceId, ws), eq(schema.proceeding.matterId, matterId)))
  ).map((p) => p.id);
  const out: Raw[] = [];
  const add = (kind: ChangeKind, at: Date, line: BriefLine, by: string | null = null) => {
    out.push({ kind, at, actor: by, line });
  };
  const plain = (text: string, row: Parameters<typeof provenanceOf>[0]): BriefLine => ({
    text,
    label: row.confirmationState === 'proposed' ? 'Unconfirmed' : null,
    page_no: null,
    quote: null,
    ...provenanceOf(row),
  });

  if (proceedings.length > 0) {
    const orders = await tx
      .select()
      .from(schema.order)
      .where(
        and(
          eq(schema.order.workspaceId, ws),
          inArray(schema.order.proceedingId, proceedings),
          gt(schema.order.createdAt, since),
        ),
      );
    for (const o of orders) {
      add('order', o.createdAt, plain(`New order of ${shortDate(o.orderDate)}`, o));
      if (o.nextDate !== null) {
        add(
          'next_date',
          o.createdAt,
          plain(`Next date ${shortDate(o.nextDate)} set by the order`, o),
        );
      }
    }
    const listings = await tx
      .select()
      .from(schema.listing)
      .where(
        and(
          eq(schema.listing.workspaceId, ws),
          inArray(schema.listing.proceedingId, proceedings),
          gt(schema.listing.createdAt, since),
        ),
      );
    for (const l of listings) {
      add('listing', l.createdAt, plain(`Listed ${shortDate(l.listDate)}: ${l.stageRaw}`, l));
    }
    const hearings = await tx
      .select({ hearing: schema.hearing })
      .from(schema.hearing)
      .innerJoin(
        schema.listing,
        and(
          eq(schema.listing.workspaceId, schema.hearing.workspaceId),
          eq(schema.listing.id, schema.hearing.listingId),
        ),
      )
      .where(
        and(
          eq(schema.hearing.workspaceId, ws),
          inArray(schema.listing.proceedingId, proceedings),
          gt(schema.hearing.updatedAt, since),
        ),
      );
    for (const { hearing: h } of hearings) {
      if (h.createdAt > since) {
        add(
          'hearing',
          h.createdAt,
          plain(
            `Hearing on ${shortDate(h.heldOn)}${h.outcome === null ? '' : `: ${h.outcome}`}`,
            h,
          ),
        );
      }
      const next = h.nextDateConfirmed ?? h.nextDateProposed;
      if (next !== null) {
        const line = plain(`Next date ${shortDate(next)}`, h);
        add(
          'next_date',
          h.updatedAt,
          h.nextDateConfirmed === null ? { ...line, label: 'Unconfirmed' } : line,
        );
      }
    }
  }

  const events = await tx
    .select({ event: schema.obligationEvent, obligation: schema.obligation })
    .from(schema.obligationEvent)
    .innerJoin(
      schema.obligation,
      and(
        eq(schema.obligation.workspaceId, schema.obligationEvent.workspaceId),
        eq(schema.obligation.id, schema.obligationEvent.obligationId),
      ),
    )
    .where(
      and(
        eq(schema.obligationEvent.workspaceId, ws),
        eq(schema.obligation.matterId, matterId),
        gt(schema.obligationEvent.at, since),
      ),
    );
  const withCreatedEvent = new Set<string>();
  for (const { event, obligation } of events) {
    if (event.kind === 'created') withCreatedEvent.add(obligation.id);
    add(
      'obligation',
      event.at,
      plain(`Obligation ${event.kind.replaceAll('_', ' ')}: ${obligation.description}`, obligation),
      event.actorMemberId,
    );
  }
  const created = await tx
    .select()
    .from(schema.obligation)
    .where(
      and(
        eq(schema.obligation.workspaceId, ws),
        eq(schema.obligation.matterId, matterId),
        gt(schema.obligation.createdAt, since),
      ),
    );
  for (const o of created) {
    if (!withCreatedEvent.has(o.id)) {
      add('obligation', o.createdAt, plain(`Obligation created: ${o.description}`, o));
    }
  }

  const documents = await tx
    .select()
    .from(schema.document)
    .where(
      and(
        eq(schema.document.workspaceId, ws),
        eq(schema.document.matterId, matterId),
        gt(schema.document.createdAt, since),
      ),
    );
  for (const d of documents) {
    add('document', d.createdAt, documentLine(d, `Document added: ${d.kind.replaceAll('_', ' ')}`));
  }
  return out;
}

/** The summary of the matter's changes since `since`, in chronological day groups. */
async function summarise(scope: ContinuityScope, matterId: string, since: Date) {
  await requireAction(scope, 'matter.read', 'You cannot read this matter');
  await loadMatter(scope, matterId);
  const raw = (await collect(scope, matterId, since))
    .filter((r) => withProvenance([r.line]).length === 1)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const groups: { day: string; items: ChangeItem[] }[] = [];
  for (const r of raw) {
    const day = new Date(r.at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const item: ChangeItem = {
      kind: r.kind,
      at: r.at.toISOString(),
      actor_member_id: r.actor,
      line: r.line,
    };
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  await audit(scope, 'continuity.changes_read', { kind: 'matter', id: matterId });
  return ChangeSummary.parse({
    matter_id: matterId,
    since: since.toISOString(),
    days_ago: Math.max(0, Math.floor((scope.now.getTime() - since.getTime()) / DAY_MS)),
    groups,
    total: raw.length,
  });
}

/** What changed on the matter since `since` (needs `matter.read`). Writes only an access audit event. */
export async function whatChangedSince(
  deps: ContinuityDeps,
  actor: ContinuityActor,
  matterId: string,
  since: Date,
): Promise<ChangeSummary> {
  const input = parseInput(WhatChangedInput, { matterId, since });
  return inContinuityScope(deps, actor, (scope) => summarise(scope, input.matterId, input.since));
}

/**
 * The card for a returning viewer: the summary since their last recorded view, then the view is
 * recorded (debounced). The first ever view returns `summary: null`: no card.
 */
export async function changesForViewer(
  deps: ContinuityDeps,
  actor: ContinuityActor,
  input: unknown,
): Promise<{ summary: ChangeSummary | null; marker: ViewMarker }> {
  const { matterId } = parseInput(RecordViewInput, input);
  return inContinuityScope(deps, actor, async (scope) => {
    await requireAction(scope, 'matter.read', 'You cannot read this matter');
    await loadMatter(scope, matterId);
    const previous = await readView(scope, matterId);
    const summary = previous === null ? null : await summarise(scope, matterId, previous);
    const marker = await writeView(scope, matterId);
    return { summary, marker };
  });
}
