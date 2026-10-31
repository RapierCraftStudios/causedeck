// The official notices poll (#586, D-048): for each cleared `notice` source, fetch its notice page
// once through the governed fetch layer (the fetch layer applies the source's rate limit, tier and
// cost caps and kill switch), parse it with the source's parser, store each notice once with
// provenance (`notice` is global, unique per source and URL, so a repeat poll inserts nothing) and
// match the newly stored ones to workspaces and matters. An uncleared source is never fetched. Only
// metadata is stored (no document body), except that the dates a holiday-list document names are
// read through an optional document fetcher and stored in `notice_holiday` (#628). Core does not import `@causedeck/fetch`: the worker wires
// the governed fetcher as a `NoticeFetcher`.
import {
  parseHolidayListHtml,
  parseHolidayListPdf,
  parseHolidayListText,
  parseVacationRangesHtml,
  parseVacationRangesPdf,
  parseVacationRangesText,
  type VacationDates,
  parseKarnatakaHcNotices,
  parseMadrasHcNotices,
  KARNATAKA_HC_NOTICES_SOURCE_ID,
  MADRAS_HC_NOTICES_SOURCE_ID,
  type NoticeParseResult,
} from '@causedeck/intelligence';
import { schema, type Database, type Transaction } from '@causedeck/db';
import type { DeliveryJob } from '@causedeck/notifications';
import { asc, eq } from 'drizzle-orm';

import { policyFor, SourceNotCleared } from '../sources/index.ts';

import { notifyNoticeMatches } from './alerts.ts';
import { matchNotices, type MatchedNotice } from './match.ts';

const { notice, noticeHoliday, noticeVacation, source } = schema;

/** Structurally the `Fetcher` of `@causedeck/fetch`, which this module does not import. */
export interface NoticeFetcher {
  fetchSource(
    sourceId: string,
    url: string,
  ): Promise<{ body: string; provenance: { url: string; fetchedAt: string; sha256: string } }>;
}

/**
 * The document a notice links to (#628): bytes for a PDF, text for an HTML or text page. Core does
 * not import `@causedeck/fetch` (string bodies only); the worker wires a governed fetcher here.
 */
export interface NoticeDocument {
  bytes?: Uint8Array;
  text?: string;
  contentType: string;
}

export type NoticeDocumentFetcher = (sourceId: string, url: string) => Promise<NoticeDocument>;

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
  /**
   * Fetches the document of each newly stored `holiday` notice; its dates are stored in
   * `notice_holiday` so a holiday list flags every date it names (#628). Without it nothing is fetched.
   */
  documentFetcher?: NoticeDocumentFetcher;
  /** Sends one `notification.deliver` job; when given, newly matched notices alert the members (#587). */
  enqueueDelivery?: (job: DeliveryJob) => Promise<unknown>;
  /**
   * Called with each (workspace, notice) newly matched, after the notice alerts (#496: the job
   * wires the bench-notice alerts here, so `notices` does not import `court`). A throw is ignored.
   */
  onMatched?: (matched: readonly MatchedNotice[]) => Promise<void>;
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
  /** Notifications sent to members for newly matched notices. */
  alerts: number;
  /** `notice_holiday` dates stored from holiday-list documents. */
  holidayDates: number;
  /** Holiday-list documents that could not be fetched or read. */
  holidayFailed: number;
  /** `notice_vacation` ranges stored from notice titles and documents (#650). */
  vacationRanges: number;
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
    alerts: 0,
    holidayDates: 0,
    holidayFailed: 0,
    vacationRanges: 0,
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
      .returning({
        id: notice.id,
        forumCodes: notice.forumCodes,
        kind: notice.kind,
        title: notice.title,
        url: notice.url,
      });
    report.inserted += inserted.length;
    // A range the title itself states (#650) needs no document.
    const titleRanges = new Map(parsed.notices.map((n) => [n.url, n.vacationRange]));
    for (const row of inserted) {
      const range = titleRanges.get(row.url);
      if (range === null || range === undefined) continue;
      report.vacationRanges += await storeVacationRanges(deps, row.id, [
        { ...range, name: row.title },
      ]);
    }
    report.duplicates += parsed.notices.length - inserted.length;
    if (deps.documentFetcher !== undefined) {
      for (const row of inserted) {
        if (row.kind !== 'holiday') continue;
        const stored = await storeHolidayDates(deps, deps.documentFetcher, sourceId, row);
        if (stored === null) {
          report.holidayFailed += 1;
          log('holiday list unreadable', { sourceId });
        } else {
          report.holidayDates += stored.dates;
          report.vacationRanges += stored.ranges;
        }
      }
    }
    const matched = await matchNotices(
      { db: deps.db },
      inserted.map((row) => ({ id: row.id, forumCodes: row.forumCodes })),
    );
    report.matches += matched.matches;
    if (deps.enqueueDelivery !== undefined) {
      report.alerts += await notifyNoticeMatches(
        { db: deps.db, enqueueDelivery: deps.enqueueDelivery },
        matched.matched,
      );
    }
    if (deps.onMatched !== undefined && matched.matched.length > 0) {
      try {
        await deps.onMatched(matched.matched);
      } catch {
        // A failing hook must not stop the poll of the other sources.
      }
    }
  }
  return report;
}

/** Vacation ranges stored for one notice; a range already stored is not stored twice. */
async function storeVacationRanges(
  deps: PollNoticesDeps,
  noticeId: string,
  ranges: readonly VacationDates[],
): Promise<number> {
  if (ranges.length === 0) return 0;
  const stored = await deps.db
    .insert(noticeVacation)
    .values(ranges.map((r) => ({ noticeId, fromOn: r.from, toOn: r.to, name: r.name })))
    .onConflictDoNothing({
      target: [noticeVacation.noticeId, noticeVacation.fromOn, noticeVacation.toOn],
    })
    .returning({ id: noticeVacation.id });
  return stored.length;
}

/**
 * The holiday dates and vacation ranges of one holiday notice's document stored; null when it could
 * not be fetched or named neither. A line stating a range is a vacation, never a holiday date (#650).
 */
async function storeHolidayDates(
  deps: PollNoticesDeps,
  fetchDocument: NoticeDocumentFetcher,
  sourceId: string,
  row: { id: string; url: string; title: string },
): Promise<{ dates: number; ranges: number } | null> {
  try {
    const document = await fetchDocument(sourceId, row.url);
    const assumeVacation = /\b(?:vacations?|recess)\b/i.test(row.title);
    const [dates, ranges] =
      document.bytes !== undefined
        ? await Promise.all([
            parseHolidayListPdf(document.bytes),
            parseVacationRangesPdf(document.bytes, { assumeVacation }),
          ])
        : /html/i.test(document.contentType)
          ? [
              parseHolidayListHtml(document.text ?? ''),
              parseVacationRangesHtml(document.text ?? '', { assumeVacation }),
            ]
          : [
              parseHolidayListText(document.text ?? ''),
              parseVacationRangesText(document.text ?? '', { assumeVacation }),
            ];
    if (dates.length === 0 && ranges.length === 0) return null;
    let storedDates = 0;
    if (dates.length > 0) {
      const stored = await deps.db
        .insert(noticeHoliday)
        .values(dates.map((d) => ({ noticeId: row.id, holidayOn: d.date, name: d.name })))
        .onConflictDoNothing({ target: [noticeHoliday.noticeId, noticeHoliday.holidayOn] })
        .returning({ id: noticeHoliday.id });
      storedDates = stored.length;
    }
    return { dates: storedDates, ranges: await storeVacationRanges(deps, row.id, ranges) };
  } catch {
    return null;
  }
}
