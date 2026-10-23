// Typed official notices read from a court or bar notice page (#585, D-048). The parsers are pure
// and total: a row that cannot be read (no link or no date) is skipped and counted, and a date or
// kind is never made up. Fetching, storage and matching are #586.
import { normaliseDate } from '@causedeck/adapters';
import type { NoticeKind } from '@causedeck/db/schema';

export interface ParsedNotice {
  title: string;
  /** ISO date printed on the row. */
  issuedOn: string;
  /** ISO date of a "with effect from" phrase in the title, else null. */
  effectiveOn: string | null;
  /** Absolute http(s) URL of the notice document. */
  url: string;
  /** Kind read from title keywords, null when the title does not say. */
  kindHint: NoticeKind | null;
  /** Forum catalogue codes the notice concerns, read from the title or the court's default benches. */
  forumCodes: string[];
}

export interface NoticeParseResult {
  notices: ParsedNotice[];
  /** Rows that looked like notices but had no readable link or date. */
  skipped: number;
}

export interface NoticeSourceConfig {
  /** The page or list URL: resolves relative links. */
  baseUrl: string;
  /** Benches of the court, used when the title names none. */
  defaultForumCodes: readonly string[];
  /** Title keyword (lower case) to the one bench it names. */
  benchKeywords: Readonly<Record<string, string>>;
}

const KIND_RULES: readonly (readonly [NoticeKind, RegExp])[] = [
  ['holiday', /\bholidays?\b|\bvacation\b/i],
  ['practice_direction', /\bpractice\s+directions?\b/i],
  ['roster', /\brosters?\b|\bbench\s+(?:constitution|composition)\b|\bsitting\b/i],
  ['gazette', /\bgazette\b/i],
  ['bar_council', /\bbar\s+council\b|\badvocates?\s+welfare\b/i],
  ['registry', /\bregistry\b|\bregistrar\b|\be-?filing\b/i],
  ['circular', /\bcircular\b|\bnotification\b|\bnotice\b/i],
];

/** The notice kind a title states, or null. First matching rule wins (specific before generic). */
export function kindFromTitle(title: string): NoticeKind | null {
  for (const [kind, pattern] of KIND_RULES) if (pattern.test(title)) return kind;
  return null;
}

const EFFECTIVE = /\b(?:w\.?e\.?f\.?|with\s+effect\s+from|effective\s+from)\s*:?\s*(.{0,40})/i;

/** The date of a "with effect from" phrase in `title`, or null. */
export function effectiveOnFromTitle(title: string): string | null {
  const tail = EFFECTIVE.exec(title);
  return tail === null ? null : normaliseDate(tail[1] ?? '');
}

/** Forum codes a title names, else the court's defaults. */
export function forumCodesFor(title: string, config: NoticeSourceConfig): string[] {
  const lower = title.toLowerCase();
  const named = Object.entries(config.benchKeywords)
    .filter(([keyword]) => lower.includes(keyword))
    .map(([, code]) => code);
  return named.length > 0 ? [...new Set(named)] : [...config.defaultForumCodes];
}

/** An absolute http(s) URL, or null (javascript:, mailto: and malformed links are dropped). */
export function absoluteUrl(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href.trim(), baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Assemble a notice from the pieces a row yielded, or null when the date or link is missing. */
export function buildNotice(
  parts: { title: string; issuedOn: string | null; url: string | null },
  config: NoticeSourceConfig,
): ParsedNotice | null {
  const title = parts.title.replace(/\s+/g, ' ').trim();
  if (title === '' || parts.issuedOn === null || parts.url === null) return null;
  return {
    title,
    issuedOn: parts.issuedOn,
    effectiveOn: effectiveOnFromTitle(title),
    url: parts.url,
    kindHint: kindFromTitle(title),
    forumCodes: forumCodesFor(title, config),
  };
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const textOf = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/i;

/**
 * Parse a notice table: one notice per `<tr>` that has a link; the link text is the title, the
 * first readable date in the row's other cells is the issue date. Scripts, styles and comments are
 * never read.
 */
export function parseNoticeTableHtml(html: string, config: NoticeSourceConfig): NoticeParseResult {
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const notices: ParsedNotice[] = [];
  let skipped = 0;
  for (const row of clean.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const body = row[1] ?? '';
    const anchor = ANCHOR.exec(body);
    if (anchor === null) continue;
    const rest = body.replace(anchor[0], ' ');
    const notice = buildNotice(
      {
        title: textOf(anchor[3] ?? ''),
        issuedOn: normaliseDate(textOf(rest)),
        url: absoluteUrl(decodeEntities(anchor[1] ?? anchor[2] ?? ''), config.baseUrl),
      },
      config,
    );
    if (notice === null) skipped += 1;
    else notices.push(notice);
  }
  return { notices, skipped };
}
