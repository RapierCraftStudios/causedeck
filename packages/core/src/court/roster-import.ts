// Roster-PDF preview (#385, part 2 of #39; ADR 0017). `previewRosterImport` reads the text layer of
// a sitting-arrangement PDF the lawyer supplied and proposes one candidate per court hall plus the
// roster's effective date, each with the line it was read from. Parsing is heuristic and always
// confirmed by the lawyer (#387, #391): nothing here touches the database, storage or events, and a
// roster without a `wef` date asks the lawyer for one. Judge names are the court-published
// composition as printed, normalised by `normaliseJudgeName` only so the confirmed bench can match
// a `bench.judges` entry; nothing aggregates by judge (PX-9, ME-6). No AI.
import { layoutFromPdf, normaliseDate, type LayoutDocument } from '@causedeck/adapters';
import { ANCHOR_QUOTE_MAX } from '@causedeck/validators/matter-graph';
import {
  RosterCandidateSchema,
  type RosterAnchor,
  type RosterCandidate,
} from '@causedeck/validators/roster';

/** What the parser proposes for a roster PDF; the lawyer reviews it before anything is stored. */
export interface RosterPreview {
  forumCode: string;
  /** The `wef` / `w.e.f.` / `with effect from` date as `YYYY-MM-DD` and its line, or null. */
  effectiveFrom: { date: string; anchor: RosterAnchor } | null;
  /** True when no date was found: the review step asks the lawyer to enter it. */
  effectiveFromRequired: boolean;
  candidates: RosterCandidate[];
}

export interface NormalisedJudgeName {
  /** Honorifics stripped, `Justice` canonical, whitespace and initials collapsed. */
  name: string;
  /** The name exactly as printed. */
  raw: string;
}

type LayoutPage = LayoutDocument['pages'][number];
type LayoutLine = LayoutPage['items'][number];

/** One leading honorific or title, with its dot or the space after it. */
const HONORIFIC =
  /^(?:the|hon'?ble|honourable|honorable|hon|mr|mrs|ms|dr|smt|sri|shri|\(dr\.?\))(?:\.\s*|\s+|$)/i;
const TITLE = /^(acting\s+chief\s+justice|chief\s+justice|justice)(?:\.\s*|\s+|$)/i;
const CANONICAL_TITLES: Record<string, string> = {
  'acting chief justice': 'Acting Chief Justice',
  'chief justice': 'Chief Justice',
  justice: 'Justice',
};

function stripHonorifics(value: string): string {
  let rest = value;
  for (let match = HONORIFIC.exec(rest); match !== null; match = HONORIFIC.exec(rest)) {
    rest = rest.slice(match[0].length);
  }
  return rest;
}

/**
 * A judge's name as one `bench.judges` entry: `Hon'ble`, `Hon.`, `Mr.`, `Mrs.`, `Ms.`, `Dr.` and
 * similar honorifics are dropped, any spelling of the `Justice` prefix becomes `Justice` (`Chief
 * Justice` stays when printed), whitespace collapses and initials join (`A. B.  Venpa` and
 * `A.B.Venpa` read `A.B. Venpa`). The rest keeps its printed letters and case; `raw` keeps all of it.
 */
export function normaliseJudgeName(raw: string): NormalisedJudgeName {
  const collapsed = raw.replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').trim();
  let rest = stripHonorifics(collapsed);
  const title = TITLE.exec(rest);
  if (title !== null) rest = stripHonorifics(rest.slice(title[0].length));
  const body = rest
    .replace(/,\s*J\.?$/, '')
    .replace(/\b([A-Za-z])\.\s*(?=[A-Za-z]\.)/g, '$1.')
    .replace(/\b([A-Za-z])\.(?=[A-Za-z]{2})/g, '$1. ')
    .replace(/\s+/g, ' ')
    .trim();
  const prefix =
    title === null
      ? ''
      : (CANONICAL_TITLES[(title[1] ?? '').toLowerCase().replace(/\s+/g, ' ')] ?? '');
  return { name: [prefix, body].filter((part) => part !== '').join(' '), raw };
}

/** `wef`, `w.e.f.`, `w. e. f.` or `with effect from`, optionally followed by `:` or `-`. */
const EFFECTIVE_PHRASE =
  /\b(?:w\s*\.\s*e\s*\.\s*f\b\.?|wef\b|with\s+effect\s+from\b)\s*[:\-–]?\s*/i;
/** A hall marker and its number at the start of a row: `Court Hall No. 1`, `CH-01`, `Court No. 12A`. */
const HALL_ROW =
  /^\s*(?:court\s*hall|c\.\s*h\.|ch|hall|court)\s*(?:no\.?|number)?\s*[-:.]?\s*(\d{1,3})([a-z])?(?=$|[\s:.,)-])(.*)$/i;
/** The signature block that ends the table. */
const FOOTER = /^\s*(?:by\s+order|registrar|sd\/-)/i;
const JUDGE_MARK = /\bjustice\b/i;
/** Separators between judges, only where the next judge's honorific or title starts. */
const JUDGE_SEPARATOR =
  /\s*(?:&|\band\b|,|;)\s*(?=(?:the\s+)?(?:hon|mr|mrs|ms|dr|smt|sri|shri|justice|chief|acting)\b)/i;

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();

function anchorOf(page: LayoutPage, line: LayoutLine): RosterAnchor {
  return {
    pageNo: page.page,
    quote: line.text.slice(0, ANCHOR_QUOTE_MAX),
    bbox: { ...line.bbox },
  };
}

/**
 * A line's table cells: its words split where the gap is wider than a column gutter. Without
 * positioned words the whole line is one cell.
 */
function cellsOf(page: LayoutPage, line: LayoutLine): string[] {
  const top = line.bbox.y;
  const bottom = line.bbox.y + line.bbox.height;
  const words = (page.words ?? [])
    .filter((word) => {
      const middle = word.bbox.y + word.bbox.height / 2;
      return middle >= top && middle <= bottom;
    })
    .sort((a, b) => a.bbox.x - b.bbox.x);
  if (words.length === 0) return [line.text];
  const cells: string[][] = [];
  let right = Number.NEGATIVE_INFINITY;
  for (const word of words) {
    const gutter = Math.max(word.bbox.height, 6) * 1.5;
    const last = cells.at(-1);
    if (last === undefined || word.bbox.x - right > gutter) cells.push([word.text]);
    else last.push(word.text);
    right = word.bbox.x + word.bbox.width;
  }
  return cells.map((cell) => cell.join(' '));
}

function judgesOf(cell: string): string[] {
  return cell
    .split(JUDGE_SEPARATOR)
    .filter((part) => JUDGE_MARK.test(part))
    .map((part) => normaliseJudgeName(part).name)
    .filter((name) => name !== '');
}

interface Draft {
  hallNo: string;
  judges: string[];
  portfolio: string[];
  anchor: RosterAnchor;
}

function addCell(draft: Draft, cell: string): void {
  const text = collapse(cell);
  if (text === '') return;
  if (JUDGE_MARK.test(text)) draft.judges.push(...judgesOf(text));
  else draft.portfolio.push(text);
}

function toCandidate(draft: Draft): RosterCandidate {
  const portfolioText = collapse(draft.portfolio.join(' '));
  const confidence = 0.4 + (draft.judges.length > 0 ? 0.4 : 0) + (portfolioText === '' ? 0 : 0.2);
  return RosterCandidateSchema.parse({
    hallNo: draft.hallNo,
    judges: draft.judges,
    portfolioText,
    confidence: Math.round(confidence * 100) / 100,
    anchor: draft.anchor,
  });
}

function findEffectiveFrom(layout: LayoutDocument): RosterPreview['effectiveFrom'] {
  for (const page of layout.pages) {
    for (const line of page.items) {
      const phrase = EFFECTIVE_PHRASE.exec(line.text);
      if (phrase === null) continue;
      const rest = line.text.slice(phrase.index + phrase[0].length);
      if (!/^\d/.test(rest)) continue;
      const date = normaliseDate(rest);
      if (date !== null) return { date, anchor: anchorOf(page, line) };
    }
  }
  return null;
}

function findCandidates(layout: LayoutDocument): RosterCandidate[] {
  const drafts: Draft[] = [];
  for (const page of layout.pages) {
    // A row does not continue onto the next page: its first lines are headings.
    let current: Draft | null = null;
    for (const line of page.items) {
      if (FOOTER.test(line.text)) {
        current = null;
        continue;
      }
      const [first = '', ...others] = cellsOf(page, line);
      const hall = HALL_ROW.exec(first);
      if (hall !== null) {
        current = {
          hallNo: `${String(Number(hall[1]))}${(hall[2] ?? '').toUpperCase()}`,
          judges: [],
          portfolio: [],
          anchor: anchorOf(page, line),
        };
        drafts.push(current);
        addCell(current, hall[3] ?? '');
      } else if (current !== null) {
        addCell(current, first);
      }
      if (current !== null) for (const cell of others) addCell(current, cell);
    }
  }
  return drafts.map(toCandidate);
}

/**
 * Proposes a forum's roster from the PDF the lawyer supplied: one candidate per court hall (its
 * number, judges as printed and normalised, portfolio text, a 0-1 confidence and the line it was
 * read from) and the effective date with its line. Nothing is persisted; a roster without a date
 * returns `effectiveFrom: null` and `effectiveFromRequired: true`.
 */
export async function previewRosterImport(
  pdfBytes: Uint8Array,
  forumCode: string,
): Promise<RosterPreview> {
  const code = forumCode.trim();
  if (code === '') throw new TypeError('previewRosterImport needs a forum code');
  const layout = await layoutFromPdf(pdfBytes);
  const effectiveFrom = findEffectiveFrom(layout);
  return {
    forumCode: code,
    effectiveFrom,
    effectiveFromRequired: effectiveFrom === null,
    candidates: findCandidates(layout),
  };
}
