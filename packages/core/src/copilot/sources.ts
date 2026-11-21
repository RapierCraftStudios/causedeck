// The sources the copilot shows the model (#1115, ADR 0051): matter-graph facts read as the actor
// (restrictions honoured by the matter-graph services), pages of the matter's own documents by full
// text over `document_page.search_tsv`, and passages of the anonymised judgment corpus. Each source
// carries the exact text the model sees, so a quote is verified against what was stored, and nothing
// outside the actor's workspace and the one matter is ever selected.
import {
  createEmbedGateway,
  createMockEmbedProvider,
  createMockRerankProvider,
  createRerankGateway,
  type EmbedGateway,
  type RerankGateway,
} from '@causedeck/ai';
import { withWorkspace, type Queryable } from '@causedeck/db';
import {
  drizzleRetriever,
  heuristicPlan,
  searchCorpusWithPlan,
  type CopilotSource,
} from '@causedeck/intelligence';
import { sql } from 'drizzle-orm';

import {
  getMatterOverview,
  listMatterDocuments,
  type GraphActor,
  type MatterGraphDeps,
} from '../matter-graph/index.ts';

/** The task caps a source's text at 6000 characters. */
export const SOURCE_TEXT_MAX = 6000;
export const DOCUMENT_PAGES_MAX = 5;
export const CORPUS_SEGMENTS_MAX = 12;
const MAX_TERMS = 12;

export interface JudgmentRef {
  id: string;
  title: string | null;
  court: string;
  neutralCitation: string | null;
}

export interface GatheredSources {
  sources: CopilotSource[];
  judgments: Record<string, JudgmentRef>;
  /** The matter is sensitive: nothing may be sent to a provider. */
  aiBlocked: boolean;
}

/** The distinct word tokens of `text` (3+ characters) as an OR full-text query. */
export function tsQueryOf(text: string): string | null {
  const terms = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(
    0,
    MAX_TERMS,
  );
  return terms.length === 0 ? null : terms.map((t) => `${t}:*`).join(' | ');
}

const cut = (text: string): string => text.slice(0, SOURCE_TEXT_MAX);

/** The matter's facts the actor may read, one short sentence each. */
export async function factSources(
  deps: MatterGraphDeps,
  actor: GraphActor,
  matterId: string,
): Promise<{ facts: CopilotSource[]; sensitive: boolean }> {
  const overview = await getMatterOverview(deps, actor, { matterId });
  const { header, proceedings, synopsis } = overview;
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
    const number = lead.number === null ? '' : ` ${lead.number}${lead.year === null ? '' : `/${String(lead.year)}`}`;
    facts.push({
      id: 'fact:proceeding',
      page: null,
      text: cut(`Lead proceeding: ${lead.caseType}${number} before ${lead.forum.court}.`),
    });
  }
  if (synopsis !== null) facts.push({ id: 'fact:synopsis', page: null, text: cut(synopsis.text) });
  return { facts, sensitive: header.sensitive };
}

/** Pages of this matter's documents that match the question; none without `document.read`. */
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
        where dp.workspace_id = ${actor.workspaceId}::uuid
          and d.matter_id = ${matterId}::uuid
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
}

/** Passages of the anonymised corpus for the question: the retrieval of `searchAuthorities`, without its planner, meter or audit. */
export async function corpusSources(
  db: Queryable,
  question: string,
  deps: CorpusDeps = {},
): Promise<{ sources: CopilotSource[]; judgments: Record<string, JudgmentRef> }> {
  const embed = deps.embed ?? createEmbedGateway({ providers: [createMockEmbedProvider()] });
  const rerank = deps.rerank ?? createRerankGateway({ providers: [createMockRerankProvider()] });
  const result = await searchCorpusWithPlan(
    {
      retriever: drizzleRetriever(db, { embeddingModel: embed.active().modelVersion }),
      embed,
      rerank,
    },
    heuristicPlan(question),
    { answer: false },
  );
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
      };
      sources.push({
        id: `seg:${s.segmentId}`,
        page: s.pageFrom,
        judgmentId: hit.judgmentId,
        text: cut(s.text),
      });
    }
  }
  return { sources, judgments };
}
