// The sources the copilot shows the model (#1115, ADR 0051): matter-graph facts read as the actor
// (restrictions honoured by the matter-graph services), including the next date, the stage and the
// open obligations (#1167, each obligation read through the obligations queue as the actor), pages of the matter's own documents by full
// text over `document_page.search_tsv`, and passages of the anonymised judgment corpus. Each source
// carries the exact text the model sees, so a quote is verified against what was stored, and nothing
// outside the actor's workspace and the one matter is ever selected.
import {
  createEmbedGateway,
  createMockRerankProvider,
  createRerankGateway,
  MOCK_EMBED_MODEL,
  type EmbedGateway,
  type RerankGateway,
} from '@causedeck/ai';
import { withWorkspace, type Queryable } from '@causedeck/db';
import {
  drizzleRetriever,
  planQuery,
  searchCorpusWithPlan,
  searchTerms,
  type CopilotSource,
  type PlanResolver,
  type ResearchPlan,
  type SearchCounts,
} from '@causedeck/intelligence';
import { sql } from 'drizzle-orm';

import { embedProviderFromEnv } from '../ai/index.ts';

import {
  getMatterOverview,
  listMatterDocuments,
  type GraphActor,
  type MatterGraphDeps,
} from '../matter-graph/index.ts';
import { queryQueue, type ObligationDeps } from '../obligations/index.ts';

/** The task caps a source's text at 6000 characters. */
export const SOURCE_TEXT_MAX = 6000;
export const DOCUMENT_PAGES_MAX = 5;
export const CORPUS_SEGMENTS_MAX = 12;
/** Open obligations shown one by one; the rest are only counted in `fact:obligations`. */
export const OBLIGATION_FACTS_MAX = 5;
const MAX_TERMS = 12;

export interface JudgmentRef {
  id: string;
  title: string | null;
  court: string;
  neutralCitation: string | null;
  /** The corpus record the claim links to, from the stored judgment. */
  sourceUrl: string | null;
}

export interface GatheredSources {
  sources: CopilotSource[];
  judgments: Record<string, JudgmentRef>;
  /** The matter is sensitive: nothing may be sent to a provider. */
  aiBlocked: boolean;
}

/**
 * The search terms of `text` (no short, question or function words, #1182) as an OR of prefixes, so a
 * page matching some words of the question still ranks; null when nothing is left to search for.
 */
export function tsQueryOf(text: string): string | null {
  const terms = searchTerms(text, MAX_TERMS);
  return terms.length === 0 ? null : terms.map((t) => `${t}:*`).join(' | ');
}

const cut = (text: string): string => text.slice(0, SOURCE_TEXT_MAX);

const QUEUE_LABEL = {
  overdue: 'overdue',
  today: 'due today',
  this_week: 'due this week',
  later: 'due later',
  undated: 'no due date',
} as const;

/**
 * Up to `OBLIGATION_FACTS_MAX` open obligations of the matter, overdue first, as the obligations
 * queue gives them to the actor (`obligation.read`, the matter's restriction, a clerk's masked
 * strategy description). A refusal is "no obligation facts".
 */
async function obligationFacts(
  deps: ObligationDeps,
  actor: GraphActor,
  matterId: string,
): Promise<CopilotSource[]> {
  let queue: Awaited<ReturnType<typeof queryQueue>>;
  try {
    queue = await queryQueue(deps, actor, { matterId, limit: OBLIGATION_FACTS_MAX });
  } catch {
    return [];
  }
  const groups = Object.keys(QUEUE_LABEL) as (keyof typeof QUEUE_LABEL)[];
  return groups
    .flatMap((group) => queue[group].map((row) => ({ group, row })))
    .slice(0, OBLIGATION_FACTS_MAX)
    .map(({ group, row }) => {
      const when =
        row.dueDate === null ? QUEUE_LABEL[group] : `${QUEUE_LABEL[group]}, ${row.dueDate}`;
      const what = row.description.trim();
      return {
        id: `fact:obligation:${row.id}`,
        page: null,
        text: cut(`Open obligation (${when})${what === '' ? '.' : `: ${what}`}`),
      };
    });
}

/** The matter's facts the actor may read, one short sentence each. */
export async function factSources(
  deps: MatterGraphDeps,
  actor: GraphActor,
  matterId: string,
  obligationDeps: ObligationDeps = deps,
): Promise<{ facts: CopilotSource[]; sensitive: boolean }> {
  const overview = await getMatterOverview(deps, actor, { matterId });
  const { header, proceedings, synopsis, nextDate } = overview;
  const facts: CopilotSource[] = [
    {
      id: 'fact:matter',
      page: null,
      text: cut(
        `Matter: ${header.title}. Status: ${header.status}.${
          header.practiceArea === null ? '' : ` Practice area: ${header.practiceArea}.`
        }`,
      ),
    },
  ];
  const lead = proceedings.lead;
  if (lead !== null) {
    const number =
      lead.number === null
        ? ''
        : ` ${lead.number}${lead.year === null ? '' : `/${String(lead.year)}`}`;
    facts.push({
      id: 'fact:proceeding',
      page: null,
      text: cut(`Lead proceeding: ${lead.caseType}${number} before ${lead.forum.court}.`),
    });
  }
  if (nextDate !== null) {
    const state = nextDate.confirmationState === 'proposed' ? ' (proposed, not confirmed)' : '';
    facts.push({
      id: 'fact:next_date',
      page: null,
      text: cut(
        `Next date: ${nextDate.date}${state}.${nextDate.stage === null ? '' : ` Stage: ${nextDate.stage}.`}`,
      ),
    });
  }
  const byState = Object.entries(proceedings.byState)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${state.replaceAll('_', ' ')} ${String(n)}`);
  if (nextDate !== null && nextDate.stage !== null) {
    facts.push({ id: 'fact:stage', page: null, text: cut(`Stage: ${nextDate.stage}.`) });
  } else if (byState.length > 0) {
    facts.push({
      id: 'fact:stage',
      page: null,
      text: cut(`Proceedings by state: ${byState.join(', ')}.`),
    });
  }
  facts.push({
    id: 'fact:obligations',
    page: null,
    text: `Open obligations: ${String(overview.openObligations)}.`,
  });
  if (synopsis !== null) facts.push({ id: 'fact:synopsis', page: null, text: cut(synopsis.text) });
  // A sensitive matter is never shown to a provider, so its obligations are not read.
  if (!header.sensitive && overview.openObligations > 0) {
    facts.push(...(await obligationFacts(obligationDeps, actor, matterId)));
  }
  return { facts, sensitive: header.sensitive };
}

/**
 * Pages of this matter's documents that match the question; none without `document.read`, and none
 * of a document whose source capture is `ai_blocked`.
 */
export async function documentSources(
  db: Queryable,
  deps: MatterGraphDeps,
  actor: GraphActor,
  matterId: string,
  question: string,
): Promise<CopilotSource[]> {
  // The matter-graph service decides `document.read` and the matter's restriction; a refusal is "no documents".
  try {
    await listMatterDocuments(deps, actor, { matterId, limit: 1 });
  } catch {
    return [];
  }
  const tsQuery = tsQueryOf(question);
  if (tsQuery === null) return [];
  const rows = await withWorkspace(
    db,
    { workspaceId: actor.workspaceId, userId: actor.userId },
    (tx) =>
      tx.execute<{ document_id: string; page_no: number; text: string }>(sql`
        select dp.document_id::text as document_id, dp.page_no, dp.text
        from document_page dp
        join document d on d.workspace_id = dp.workspace_id and d.id = dp.document_id
        left join capture c on c.workspace_id = d.workspace_id and c.id = d.source_capture_id
        where dp.workspace_id = ${actor.workspaceId}::uuid
          and d.matter_id = ${matterId}::uuid
          -- the text of an ai_blocked capture never reaches a provider (CA-10)
          and coalesce(c.ai_blocked, false) = false
          and dp.search_tsv @@ to_tsquery('simple', ${tsQuery})
        order by ts_rank(dp.search_tsv, to_tsquery('simple', ${tsQuery})) desc, dp.document_id, dp.page_no
        limit ${DOCUMENT_PAGES_MAX}
      `),
  );
  return rows
    .filter((r) => r.text.trim() !== '')
    .map((r) => ({
      id: `doc:${r.document_id}:${String(r.page_no)}`,
      page: r.page_no,
      documentId: r.document_id,
      text: cut(r.text),
    }));
}

export interface CorpusDeps {
  embed?: EmbedGateway;
  rerank?: RerankGateway;
  /** The planner model (`plan_research_query`); without one the rules plan the question. */
  plan?: PlanResolver;
}

const hasFacets = (plan: ResearchPlan): boolean =>
  plan.subjectAreas.length > 0 ||
  plan.statutes.length > 0 ||
  plan.courts.length > 0 ||
  plan.courtLevel !== null ||
  plan.dateFrom !== null ||
  plan.dateTo !== null ||
  plan.outcome !== null;

/** `plan` searching its query and keywords only. */
const withoutFacets = (plan: ResearchPlan): ResearchPlan => ({
  ...plan,
  subjectAreas: [],
  statutes: [],
  courts: [],
  courtLevel: null,
  dateFrom: null,
  dateTo: null,
  outcome: null,
});

/**
 * Passages of the anonymised corpus for the question: the retrieval of `searchAuthorities`, without its
 * meter or audit. The embedder is `deps.embed`, else the configured one (`embedProviderFromEnv`, #1198:
 * bge-m3 when set, else the mock), and only vectors of its model version are queried. While the mock
 * is active the lexical arm runs alone (#1182). A question is not
 * vetoed by a facet: when the faceted search finds nothing, it searches once more without facets.
 */
export async function corpusSources(
  db: Queryable,
  question: string,
  deps: CorpusDeps = {},
): Promise<{
  sources: CopilotSource[];
  judgments: Record<string, JudgmentRef>;
  counts: SearchCounts;
}> {
  const embed = deps.embed ?? createEmbedGateway({ providers: [embedProviderFromEnv()] });
  const rerank = deps.rerank ?? createRerankGateway({ providers: [createMockRerankProvider()] });
  const active = embed.active();
  const search = {
    retriever: drizzleRetriever(db, { embeddingModel: active.modelVersion }),
    embed,
    rerank,
    lexicalOnly: active.model === MOCK_EMBED_MODEL,
  };
  const plan = await planQuery(question, deps.plan);
  let result = await searchCorpusWithPlan(search, plan, { answer: false });
  if (result.hits.length === 0 && hasFacets(plan)) {
    result = await searchCorpusWithPlan(search, withoutFacets(plan), { answer: false });
  }
  const judgments: Record<string, JudgmentRef> = {};
  const sources: CopilotSource[] = [];
  for (const hit of result.hits) {
    for (const s of hit.segments) {
      if (sources.length >= CORPUS_SEGMENTS_MAX) break;
      judgments[hit.judgmentId] = {
        id: hit.judgmentId,
        title: hit.title,
        court: hit.court,
        neutralCitation: hit.neutralCitation,
        sourceUrl: hit.sourceUrl,
      };
      sources.push({
        id: `seg:${s.segmentId}`,
        page: s.pageFrom,
        judgmentId: hit.judgmentId,
        text: cut(s.text),
      });
    }
  }
  return { sources, judgments, counts: result.counts };
}
