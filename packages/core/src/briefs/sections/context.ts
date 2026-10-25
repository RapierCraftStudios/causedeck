// The document-context section (#60, ADR 0038): at most 5 passages from the matter's own documents,
// by full-text over `document_page.search_tsv` (no embedding table exists), each with its page and a
// quote. The query joins the matter's documents inside the workspace scope, so a passage of another
// matter or workspace is never returned. Skipped for a sensitive matter by the caller.
import { sql } from 'drizzle-orm';
import type { ContextPassage, ObligationLine } from '@causedeck/validators';
import { MAX_CONTEXT_PASSAGES } from '@causedeck/validators';

import type { BriefScope, ListingContext } from '../assemble.ts';

const QUOTE_MAX = 300;
const MAX_TERMS = 12;

/** The distinct word tokens of `text` (at least 3 characters) as an OR full-text query. */
export function toTsQuery(text: string): string | null {
  const terms = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(
    0,
    MAX_TERMS,
  );
  return terms.length === 0 ? null : terms.map((t) => `${t}:*`).join(' | ');
}

/** The passage of `pageText` around the first query term, at most 300 characters. */
export function quoteFor(pageText: string, query: string): string {
  const flat = pageText.replace(/\s+/g, ' ').trim();
  const terms = query.split(' | ').map((t) => t.replace(':*', ''));
  const at = Math.max(
    0,
    Math.min(...terms.map((t) => flat.toLowerCase().indexOf(t)).filter((i) => i >= 0), flat.length),
  );
  const start = Math.max(0, at - 60);
  return flat.slice(start, start + QUOTE_MAX).trim();
}

export async function contextSection(
  scope: BriefScope,
  listing: ListingContext,
  open: ObligationLine[],
  explicit?: string,
): Promise<ContextPassage[]> {
  const tsQuery = toTsQuery(explicit ?? [listing.stageRaw, ...open.map((o) => o.text)].join(' '));
  if (tsQuery === null) return [];
  const { tx, actor } = scope;
  const rows = await tx.execute<{
    document_id: string;
    page_no: number;
    text: string;
    anchor_id: string | null;
  }>(sql`
    select dp.document_id::text as document_id, dp.page_no, dp.text,
      (select a.id::text from anchor a
        where a.workspace_id = dp.workspace_id and a.document_id = dp.document_id
          and a.page_no = dp.page_no order by a.created_at, a.id limit 1) as anchor_id
    from document_page dp
    join document d on d.workspace_id = dp.workspace_id and d.id = dp.document_id
    where dp.workspace_id = ${actor.workspaceId}::uuid
      and d.matter_id = ${listing.matterId}::uuid
      and dp.search_tsv @@ to_tsquery('simple', ${tsQuery})
    order by ts_rank(dp.search_tsv, to_tsquery('simple', ${tsQuery})) desc, dp.document_id, dp.page_no
    limit ${MAX_CONTEXT_PASSAGES}
  `);
  return rows
    .map((r) => ({
      document_id: r.document_id,
      anchor_id: r.anchor_id,
      page_no: r.page_no,
      quote: quoteFor(r.text ?? '', tsQuery),
    }))
    .filter((p) => p.quote.length > 0);
}
