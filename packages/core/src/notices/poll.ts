// The official notices poll (#586, D-048): for each cleared `notice` source, fetch its notice page
// once through the governed fetch layer (the fetch layer applies the source's rate limit, tier and
// cost caps and kill switch), parse it with the source's parser, store each notice once with
// provenance (`notice` is global, unique per source and URL, so a repeat poll inserts nothing) and
// match the newly stored ones to workspaces and matters. An uncleared source is never fetched. Only
// metadata is stored (no document body). Core does not import `@causedeck/fetch`: the worker wires
// the governed fetcher as a `NoticeFetcher`.
import {
  parseKarnatakaHcNotices,
  parseMadrasHcNotices,
  KARNATAKA_HC_NOTICES_SOURCE_ID,
  MADRAS_HC_NOTICES_SOURCE_ID,
  type NoticeParseResult,
} from '@causedeck/intelligence';
import { schema, type Database, type Transaction } from '@causedeck/db';
import { asc, eq } from 'drizzle-orm';

import { policyFor, SourceNotCleared } from '../sources/index.ts';

import { matchNotices } from './match.ts';

const { notice, source } = schema;

/** Structurally the `Fetcher` of `@causedeck/fetch`, which this module does not import. */
export interface NoticeFetcher {
  fetchSource(
    sourceId: string,
    url: string,
  ): Promise<{ body: string; provenance: { url: string; fetchedAt: string; sha256: string } }>;
}

export type NoticeParser = (html: string, baseUrl: string) => NoticeParseResult;

/** The sources with a parser (#585); other notice sources are skipped until one is written. */
export const NOTICE_PARSERS: Readonly<Record<string, NoticeParser>> = {
  [MADRAS_HC_NOTICES_SOURCE_ID]: parseMadrasHcNotices,
  [KARNATAKA_HC_NOTICES_SOURCE_ID]: parseKarnatakaHcNotices,
};

export interface PollNoticesDeps {
  db: Database | Transaction;
  fetcher: NoticeFetcher;
  /** Poll this source only. */
  sourceId?: string;
  /** Counts only; never a notice title or URL. */
  log?: (event: string, counts: Record<string, string | number>) => void;
  /** The source's policy; throws `SourceNotCleared` when it may not be fetched. Defaults to the registry. */
  policy?: (sourceId: string) => Promise<{ baseUrl: string }>;
  parsers?: Readonly<Record<string, NoticeParser>>;
}

export interface PollNoticesReport {
  /** Cleared sources fetched. */
  sources: number;
  /** Sources skipped: uncleared, or cleared but without a parser. */
  skipped: number;
  /** Sources whose fetch failed. */
  failed: number;
  /** Notices stored for the first time. */
  inserted: number;
  /** Notices already stored. */
  duplicates: number;
  /** Rows on a page that could not be read (no link or date). */
  unreadable: number;
  /** `notice_match` rows written. */
  matches: number;
}

/** Fetch, store and match the notices of every cleared `notice` source. */
export async function pollNotices(deps: PollNoticesDeps): Promise<PollNoticesReport> {
  const log = deps.log ?? (() => undefined);
  const policy = deps.policy ?? ((id: string) => policyFor(id, { db: deps.db }));
  const parsers = deps.parsers ?? NOTICE_PARSERS;
  const report: PollNoticesReport = {
    sources: 0,
    skipped: 0,
    failed: 0,
    inserted: 0,
    duplicates: 0,
    unreadable: 0,
    matches: 0,
  };
  const ids =
    deps.sourceId !== undefined
      ? [deps.sourceId]
      : (
          await deps.db
            .select({ id: source.id })
            .from(source)
            .where(eq(source.kind, 'notice'))
            .orderBy(asc(source.id))
        ).map((row) => row.id);

  for (const sourceId of ids) {
    let baseUrl: string;
    try {
      baseUrl = (await policy(sourceId)).baseUrl;
    } catch (error) {
      if (!(error instanceof SourceNotCleared)) throw error;
      report.skipped += 1;
      log('skipped: not cleared', { sourceId });
      continue;
    }
    const parse = parsers[sourceId];
    if (parse === undefined) {
      report.skipped += 1;
      log('skipped: no parser', { sourceId });
      continue;
    }
    let parsed: NoticeParseResult;
    try {
      parsed = parse((await deps.fetcher.fetchSource(sourceId, baseUrl)).body, baseUrl);
    } catch (error) {
      report.failed += 1;
      log('notices fetch failed', {
        sourceId,
        error: error instanceof Error ? error.name : 'error',
      });
      continue;
    }
    report.sources += 1;
    report.unreadable += parsed.skipped;
    if (parsed.notices.length === 0) continue;

    const inserted = await deps.db
      .insert(notice)
      .values(
        parsed.notices.map((n) => ({
          sourceId,
          forumCodes: n.forumCodes,
          kind: n.kindHint ?? ('other' as const),
          title: n.title,
          issuedOn: n.issuedOn,
          effectiveOn: n.effectiveOn,
          url: n.url,
          sourceType: 'adapter' as const,
          sourceRef: n.url,
        })),
      )
      .onConflictDoNothing({ target: [notice.sourceId, notice.url] })
      .returning({ id: notice.id, forumCodes: notice.forumCodes });
    report.inserted += inserted.length;
    report.duplicates += parsed.notices.length - inserted.length;
    const matched = await matchNotices(
      { db: deps.db },
      inserted.map((row) => ({ id: row.id, forumCodes: row.forumCodes })),
    );
    report.matches += matched.matches;
  }
  return report;
}
