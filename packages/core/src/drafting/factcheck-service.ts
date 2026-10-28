// Fact-check service (#914, part 2 of #170). `runFactCheck` extracts the claims of one immutable draft
// version with the pure engine in `@causedeck/drafting`, verifies them against the matter record
// (facts read through the matter-graph index as the actor, only the draft's own matter) and stores
// one `checked` marker plus one `blocker` per mismatch or unverified citation in `draft_fact_ack`.
// The lawyer then decides: `ignoreForMatter` (a matter-scoped dismissal that holds across versions),
// `markAsAssertion` (the author stands behind the claim; records who), or acknowledges the rest before
// an export (`acknowledgeFactCheck`, in citation-ack.ts, beside the citation gate). Nothing here
// writes a claim, proposes a replacement or judges a merit (PX-6). Draft text never reaches a log or
// an audit row: rows and events hold canonical claim keys, kinds and counts.
import {
  createMockResolver,
  extractClaims,
  extractWithPort,
  validateBlockTree,
  verify,
  walkBlocks,
  type Block,
  type Claim,
  type CitationResolver,
  type ClaimPort,
  type ClaimVerdict,
  type FactStatus,
  type MatterFacts,
  NO_MATTER_FACTS,
} from '@causedeck/drafting';
import { schema, type Database, type Transaction } from '@causedeck/db';
import {
  FactCheckRunInput,
  FactClaimDecisionInput,
  FACT_CLAIM_KEY_MAX,
  RecordFactFixInput,
} from '@causedeck/validators/factcheck';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import {
  getMatterTimeline,
  listMatterProceedingsTree,
  type GraphEvents,
  type ProceedingNode,
} from '../matter-graph/index.ts';
import { conflict, invalid, notFound } from '../shared/errors.ts';

import { asDraftMember, requireDraft, requireMatterAccess, type DraftActor } from './policy.ts';
import type { DraftingDeps } from './service.ts';

const { authority, draft, draftFactAck, draftVersion } = schema;

const NO_EVENTS: GraphEvents = {
  emit() {
    // Reading facts emits nothing.
  },
};

type Deps = DraftingDeps & {
  db: Database | Transaction;
  resolver?: CitationResolver;
  /** Optional model-backed claim finder; only the `deep` live check uses it. */
  claimPort?: ClaimPort;
};

/** Statuses that hold an export back until the lawyer decides. */
const BLOCKING: readonly FactStatus[] = ['mismatch', 'unverified-citation'];

export type FactResolution = 'open' | 'ignored' | 'asserted';

export interface FactVerdictView {
  claimId: string;
  claimKey: string;
  kind: Claim['kind'];
  status: FactStatus;
  resolution: FactResolution;
  anchor: ClaimVerdict['anchor'];
}

export interface FactCheckResult {
  draftVersionId: string;
  verdicts: FactVerdictView[];
  /** Mismatches and unverified citations nobody ignored, asserted or acknowledged. */
  unresolved: number;
  acknowledged: boolean;
}

/** `<kind>:<canonical value>`: the same claim in another version or spot has the same key. */
export const claimKeyOf = (claim: Pick<Claim, 'kind' | 'value'>): string =>
  `${claim.kind}:${claim.value}`.slice(0, FACT_CLAIM_KEY_MAX);

const flatten = (nodes: readonly ProceedingNode[]): ProceedingNode[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children)]);

/**
 * The plain facts of one matter for the engine, read through the matter-graph index as the actor so
 * its visibility rules apply: a matter the actor cannot read is NOT_FOUND, never another matter's data.
 */
export async function loadFactCheckFacts(
  deps: Deps,
  actor: DraftActor,
  matterId: string | null,
): Promise<MatterFacts> {
  if (matterId === null) return NO_MATTER_FACTS;
  const graph = { db: deps.db, events: NO_EVENTS, ...(deps.now ? { now: deps.now } : {}) };
  const tree = await listMatterProceedingsTree(graph, actor, { matterId });
  const timeline = await getMatterTimeline(graph, actor, { matterId, kinds: ['listing', 'order'] });
  const nodes = flatten(tree);
  const anchor = (id: string, quote: string) => ({
    document: `proceeding:${id}`,
    page: null,
    quote,
  });
  return {
    proceedings: nodes.flatMap((n) =>
      n.number !== null && n.year !== null
        ? [
            {
              caseType: n.caseType,
              number: n.number,
              year: n.year,
              anchor: anchor(n.id, `${n.caseType} ${n.number}/${String(n.year)}`),
            },
          ]
        : [],
    ),
    dates: timeline.map((e) => ({
      iso: e.date,
      context: e.kind === 'order' ? ('order' as const) : ('listing' as const),
      anchor: { document: `matter-event:${e.anchorId ?? e.kind}`, page: null, quote: e.date },
    })),
    parties: nodes.flatMap((n) => [
      ...(n.petitioner
        ? [{ role: 'petitioner' as const, name: n.petitioner, anchor: anchor(n.id, n.petitioner) }]
        : []),
      ...(n.respondent
        ? [{ role: 'respondent' as const, name: n.respondent, anchor: anchor(n.id, n.respondent) }]
        : []),
    ]),
    amounts: [],
    cnrs: nodes.flatMap((n) =>
      n.cnr === null ? [] : [{ cnr: n.cnr, anchor: anchor(n.id, n.cnr) }],
    ),
    courtRefs: [],
  };
}

function textOf(block: Block): string | undefined {
  if (block.type === 'heading' || block.type === 'paragraph') return block.text;
  if (block.type === 'section') return block.title;
  return undefined;
}

function claimsOf(content: unknown): Claim[] {
  const parsed = validateBlockTree(content);
  if (!parsed.ok) throw invalid('Invalid draft content');
  const claims: Claim[] = [];
  walkBlocks(parsed.blocks, ({ block, key }) => {
    const text = textOf(block);
    if (text !== undefined) claims.push(...extractClaims(text, key));
  });
  return claims;
}

async function loadVersion(
  tx: Transaction,
  reader: Parameters<typeof requireDraft>[1],
  settings: Parameters<typeof requireDraft>[2],
  draftVersionId: string,
  action: 'draft.read' | 'draft.write' | 'draft.export',
) {
  const [version] = await tx
    .select({ id: draftVersion.id, draftId: draftVersion.draftId, content: draftVersion.content })
    .from(draftVersion)
    .where(
      and(eq(draftVersion.workspaceId, reader.workspaceId), eq(draftVersion.id, draftVersionId)),
    )
    .limit(1);
  if (version === undefined) throw notFound('Version not found');
  const row = await requireDraft(tx, reader, settings, version.draftId, action);
  return { version, matterId: row.matterId };
}

export interface FactBlockers {
  checked: boolean;
  acknowledged: boolean;
  /** The stored blockers nobody decided on. */
  open: (typeof draftFactAck.$inferSelect)[];
  all: (typeof draftFactAck.$inferSelect)[];
}

/** What stands between a version and its export, from stored state only; reads inside `tx`. */
export async function openFactBlockers(
  tx: Transaction,
  workspaceId: string,
  draftVersionId: string,
): Promise<FactBlockers> {
  const rows = await tx
    .select()
    .from(draftFactAck)
    .where(
      and(
        eq(draftFactAck.workspaceId, workspaceId),
        eq(draftFactAck.draftVersionId, draftVersionId),
      ),
    );
  const [owner] = await tx
    .select({ matterId: draft.matterId })
    .from(draftVersion)
    .innerJoin(
      draft,
      and(eq(draft.workspaceId, draftVersion.workspaceId), eq(draft.id, draftVersion.draftId)),
    )
    .where(and(eq(draftVersion.workspaceId, workspaceId), eq(draftVersion.id, draftVersionId)))
    .limit(1);
  const decided = new Set<string>();
  if (owner?.matterId) {
    const decisions = await tx
      .select({ claimKey: draftFactAck.claimKey })
      .from(draftFactAck)
      .where(
        and(
          eq(draftFactAck.workspaceId, workspaceId),
          eq(draftFactAck.matterId, owner.matterId),
          inArray(draftFactAck.kind, ['ignore', 'assertion']),
        ),
      );
    for (const d of decisions) decided.add(d.claimKey);
  }
  // A citation the member already acknowledged through the citation gate is not asked about twice.
  const acked = await tx
    .select({ blockId: authority.blockId, span: authority.span })
    .from(authority)
    .where(
      and(
        eq(authority.workspaceId, workspaceId),
        eq(authority.draftVersionId, draftVersionId),
        isNotNull(authority.ackAt),
      ),
    );
  const ackedIds = new Set(
    acked.map((a) => `${a.blockId}:${String(a.span[0])}-${String(a.span[1])}`),
  );
  const all = rows.filter((r) => r.kind === 'blocker');
  return {
    checked: rows.some((r) => r.kind === 'checked'),
    acknowledged: rows.some((r) => r.kind === 'export_ack'),
    open: all.filter(
      (r) =>
        !decided.has(r.claimKey) &&
        !(r.status === 'unverified-citation' && r.claimId !== null && ackedIds.has(r.claimId)),
    ),
    all,
  };
}

/** Check one draft version against the matter record and store what blocks its export. */
export async function runFactCheck(
  deps: Deps,
  actor: DraftActor,
  input: { draftVersionId: string },
): Promise<FactCheckResult> {
  const parsed = FactCheckRunInput.safeParse(input);
  if (!parsed.success) throw invalid('Give the draft version to check');
  const { draftVersionId } = parsed.data;
  const target = await asDraftMember(deps.db, actor, (tx, reader, settings) =>
    loadVersion(tx, reader, settings, draftVersionId, 'draft.read'),
  );
  const claims = claimsOf(target.version.content);
  const facts = await loadFactCheckFacts(deps, actor, target.matterId);
  const verdicts = await verify(claims, facts, {
    resolver: deps.resolver ?? createMockResolver(),
    workspaceId: actor.workspaceId,
  });
  return asDraftMember(deps.db, actor, async (tx, reader) => {
    const scope = and(
      eq(draftFactAck.workspaceId, reader.workspaceId),
      eq(draftFactAck.draftVersionId, draftVersionId),
      inArray(draftFactAck.kind, ['checked', 'blocker']),
    );
    await tx.delete(draftFactAck).where(scope);
    const blockers = verdicts.filter((v) => BLOCKING.includes(v.status));
    await tx.insert(draftFactAck).values([
      { workspaceId: reader.workspaceId, kind: 'checked', draftVersionId, userId: reader.userId },
      ...blockers.map((v) => ({
        workspaceId: reader.workspaceId,
        kind: 'blocker',
        draftVersionId,
        claimKey: claimKeyOf(v.claim),
        claimId: v.claim.id,
        status: v.status,
        userId: reader.userId,
      })),
    ]);
    const state = await openFactBlockers(tx, reader.workspaceId, draftVersionId);
    const decided = await decisionsOf(tx, reader.workspaceId, target.matterId);
    await record(
      { db: tx, workspaceId: reader.workspaceId, actor: { userId: reader.userId, kind: 'user' } },
      {
        action: 'draft.factcheck.checked',
        target: { kind: 'draft_version', id: draftVersionId },
        metadata: {
          claims: claims.length,
          blockers: blockers.length,
          unresolved: state.open.length,
        },
      },
    );
    return {
      draftVersionId,
      unresolved: state.open.length,
      acknowledged: state.acknowledged,
      verdicts: verdicts.map((v): FactVerdictView => {
        const key = claimKeyOf(v.claim);
        return {
          claimId: v.claim.id,
          claimKey: key,
          kind: v.claim.kind,
          status: v.status,
          resolution: BLOCKING.includes(v.status) ? (decided.get(key) ?? 'open') : 'open',
          anchor: v.anchor,
        };
      }),
    };
  });
}

async function decisionsOf(
  tx: Transaction,
  workspaceId: string,
  matterId: string | null,
): Promise<Map<string, FactResolution>> {
  const out = new Map<string, FactResolution>();
  if (matterId === null) return out;
  const rows = await tx
    .select({ claimKey: draftFactAck.claimKey, kind: draftFactAck.kind })
    .from(draftFactAck)
    .where(
      and(
        eq(draftFactAck.workspaceId, workspaceId),
        eq(draftFactAck.matterId, matterId),
        inArray(draftFactAck.kind, ['ignore', 'assertion']),
      ),
    );
  for (const r of rows) out.set(r.claimKey, r.kind === 'ignore' ? 'ignored' : 'asserted');
  return out;
}

async function decide(
  deps: { db: Database | Transaction },
  actor: DraftActor,
  input: unknown,
  kind: 'ignore' | 'assertion',
): Promise<{ draftVersionId: string; claimKey: string }> {
  const parsed = FactClaimDecisionInput.safeParse(input);
  if (!parsed.success) throw invalid('Give the draft version and the claim');
  const { draftVersionId, claimKey } = parsed.data;
  return asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    const { version, matterId } = await loadVersion(
      tx,
      reader,
      settings,
      draftVersionId,
      'draft.write',
    );
    if (matterId === null) throw invalid('This draft is not linked to a matter');
    if (!claimsOf(version.content).some((c) => claimKeyOf(c) === claimKey)) {
      throw notFound('Claim not found in this version');
    }
    await tx
      .insert(draftFactAck)
      .values({ workspaceId: reader.workspaceId, kind, matterId, claimKey, userId: reader.userId })
      .onConflictDoNothing();
    await record(
      { db: tx, workspaceId: reader.workspaceId, actor: { userId: reader.userId, kind: 'user' } },
      {
        action: kind === 'ignore' ? 'draft.factcheck.ignored' : 'draft.factcheck.asserted',
        target: { kind: 'draft_version', id: draftVersionId },
        metadata: { claimKey, matterId },
      },
    );
    return { draftVersionId, claimKey };
  });
}

/** "Ignore for this matter": the claim stops blocking every draft of the matter (`draft.write`). */
export const ignoreForMatter = (
  deps: { db: Database | Transaction },
  actor: DraftActor,
  input: unknown,
) => decide(deps, actor, input, 'ignore');

/** "Mark as my assertion": the author stands behind the claim; the row records who (`draft.write`). */
export const markAsAssertion = (
  deps: { db: Database | Transaction },
  actor: DraftActor,
  input: unknown,
) => decide(deps, actor, input, 'assertion');

export interface FactFixResult {
  toVersionId: string;
  fixed: number;
}

/**
 * After a fix saved a new version: re-check it and, for each blocker of the earlier version that is
 * gone, write the activity-feed entry (`draft.factcheck.fixed`; kinds and counts, no draft text).
 */
export async function recordFactFix(
  deps: Deps,
  actor: DraftActor,
  input: { fromVersionId: string; toVersionId: string },
): Promise<FactFixResult> {
  const parsed = RecordFactFixInput.safeParse(input);
  if (!parsed.success) throw invalid('Give the earlier and the new version');
  const { fromVersionId, toVersionId } = parsed.data;
  const before = await asDraftMember(deps.db, actor, async (tx, reader, settings) => {
    const from = await loadVersion(tx, reader, settings, fromVersionId, 'draft.write');
    const to = await loadVersion(tx, reader, settings, toVersionId, 'draft.write');
    if (from.version.draftId !== to.version.draftId) throw conflict('Not versions of one draft');
    return openFactBlockers(tx, reader.workspaceId, fromVersionId);
  });
  if (!before.checked) return { toVersionId, fixed: 0 };
  await runFactCheck(deps, actor, { draftVersionId: toVersionId });
  return asDraftMember(deps.db, actor, async (tx, reader) => {
    const after = await openFactBlockers(tx, reader.workspaceId, toVersionId);
    const remaining = new Set(after.all.map((r) => r.claimKey));
    const fixed = before.all.filter((r) => !remaining.has(r.claimKey));
    if (fixed.length > 0) {
      await record(
        { db: tx, workspaceId: reader.workspaceId, actor: { userId: reader.userId, kind: 'user' } },
        {
          action: 'draft.factcheck.fixed',
          target: { kind: 'draft_version', id: toVersionId },
          metadata: {
            fromVersionId,
            count: fixed.length,
            kinds: [...new Set(fixed.map((r) => r.claimKey.split(':')[0] ?? ''))].join(','),
          },
        },
      );
    }
    return { toVersionId, fixed: fixed.length };
  });
}

export interface LiveFactVerdict extends FactVerdictView {
  blockKey: string;
  /** `[start, end)` in the block text as sent. */
  start: number;
  end: number;
}

export interface LiveFactCheckResult {
  verdicts: LiveFactVerdict[];
  /** True when a model-backed claim finder ran; false means the rule pass is all there is. */
  deep: boolean;
}

const LIVE_MAX_BLOCKS = 300;
const LIVE_MAX_TEXT = 20_000;

/**
 * The live, read-only check of unsaved text (#916): claims in `blocks` against one matter's record.
 * It stores nothing (no `draft_fact_ack` rows, no audit event) so it can run on every pause in
 * typing; the matter must be readable by the actor (NOT_FOUND otherwise) and the role needs
 * `draft.read`. Ignored and asserted claims come back resolved, as in `runFactCheck`. With
 * `deep` and an injected claim port the model's extra claims are added; no draft text is logged.
 */
export async function checkFactsLive(
  deps: Deps,
  actor: DraftActor,
  input: {
    matterId: string;
    blocks: readonly { key: string; text: string }[];
    deep?: boolean;
  },
): Promise<LiveFactCheckResult> {
  const blocks = input.blocks;
  const raw: readonly { key: unknown; text: unknown }[] = blocks;
  if (
    typeof input.matterId !== 'string' ||
    raw.length > LIVE_MAX_BLOCKS ||
    raw.some(
      (b) =>
        typeof b.key !== 'string' ||
        b.key === '' ||
        typeof b.text !== 'string' ||
        b.text.length > LIVE_MAX_TEXT,
    )
  ) {
    throw invalid('Give the matter and the text blocks to check');
  }
  await asDraftMember(deps.db, actor, (tx, reader, settings) =>
    requireMatterAccess(tx, reader, settings, input.matterId, 'draft.read'),
  );
  const port = input.deep === true ? deps.claimPort : undefined;
  const claims: Claim[] = [];
  for (const b of blocks) claims.push(...(await extractWithPort(b.text, b.key, port)));
  const facts = await loadFactCheckFacts(deps, actor, input.matterId);
  const verdicts = await verify(claims, facts, {
    resolver: deps.resolver ?? createMockResolver(),
    workspaceId: actor.workspaceId,
  });
  const decided = await asDraftMember(deps.db, actor, (tx, reader) =>
    decisionsOf(tx, reader.workspaceId, input.matterId),
  );
  return {
    deep: port !== undefined,
    verdicts: verdicts.map((v): LiveFactVerdict => {
      const key = claimKeyOf(v.claim);
      return {
        claimId: v.claim.id,
        claimKey: key,
        kind: v.claim.kind,
        status: v.status,
        resolution: BLOCKING.includes(v.status) ? (decided.get(key) ?? 'open') : 'open',
        anchor: v.anchor,
        blockKey: v.claim.blockKey,
        start: v.claim.start,
        end: v.claim.end,
      };
    }),
  };
}
