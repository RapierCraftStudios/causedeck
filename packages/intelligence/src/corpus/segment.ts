// Judgment segmentation (#893, ADR 0051 §Segments): the redacted text is split into paragraphs (the
// court's numbered paragraphs where present), each paragraph gets a rhetorical role, and consecutive
// paragraphs of one role are packed into segments of 300-600 tokens that never cross a role boundary.
// Segments tile the text: their concatenation equals `fullText(pages)` exactly (no loss), and each
// keeps the page range it spans. Roles come from rules plus a sequence prior; paragraphs below the
// confidence threshold may go to a resolver (the AI gateway), whose reply is schema-validated, and an
// invalid or missing reply keeps the rule role. Pure: this package imports no gateway.
import { z } from 'zod';

/** Bump when the rules, the packing or the roles change; the job re-segments judgments below it. */
export const SEGMENT_VERSION = 1;

export const SEGMENT_ROLES = [
  'header',
  'facts',
  'issues',
  'arguments',
  'reasoning',
  'decision',
  'other',
] as const;
export type SegmentRole = (typeof SEGMENT_ROLES)[number];

export const MIN_SEGMENT_TOKENS = 300;
export const MAX_SEGMENT_TOKENS = 600;
/** Rule confidence below this goes to the resolver, when there is one. */
export const ROLE_CONFIDENCE_THRESHOLD = 0.6;
const MAX_RESOLVER_ITEMS = 50;

export interface SegmentPage {
  pageNo: number;
  text: string;
}

export interface Segment {
  ordinal: number;
  role: SegmentRole;
  pageFrom: number;
  pageTo: number;
  text: string;
}

export interface Paragraph {
  start: number;
  end: number;
  text: string;
  /** The court's paragraph number when the paragraph opens with one. */
  number: number | null;
}

export interface RoleGuess {
  role: SegmentRole;
  confidence: number;
}

/** The text segments tile: pages joined by a newline. */
export function fullText(pages: readonly SegmentPage[]): string {
  return pages.map((p) => p.text).join('\n');
}

/** Approximate tokens (four characters each); the packer only needs a stable measure. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const NUMBERED = /^[ \t]*(\d{1,3})[.)][ \t]+\S/;

/** Paragraphs that tile `text`: each ends where the next begins, separators included. */
export function splitParagraphs(text: string): Paragraph[] {
  if (text === '') return [];
  const cuts = new Set<number>();
  for (const m of text.matchAll(/\n[ \t]*\n\s*/g)) cuts.add(m.index + m[0].length);
  for (const m of text.matchAll(/\n(?=[ \t]*\d{1,3}[.)][ \t]+\S)/g)) cuts.add(m.index + 1);
  const bounds = [0, ...[...cuts].filter((c) => c > 0 && c < text.length).sort((a, b) => a - b)];
  const out: Paragraph[] = [];
  for (const [i, start] of bounds.entries()) {
    const end = bounds[i + 1] ?? text.length;
    const body = text.slice(start, end);
    if (body.trim() === '') {
      const last = out[out.length - 1];
      if (last) {
        last.end = end;
        last.text = text.slice(last.start, end);
      } else out.push({ start, end, text: body, number: null });
      continue;
    }
    const n = NUMBERED.exec(body);
    out.push({ start, end, text: body, number: n?.[1] ? Number(n[1]) : null });
  }
  return out;
}

type Rules = Record<Exclude<SegmentRole, 'other'>, readonly RegExp[]>;

const RULES: Rules = {
  header: [
    /\b(?:versus|vs?\.)\s/i,
    /\b(?:before|coram)\b\s*:?/i,
    /\bhon'?ble\b/i,
    /\b(?:civil|criminal)\s+(?:appeal|revision)\b|\bwrit\s+petition\b|\bspecial\s+leave\b|\bSLP\b|\bW\.?P\.?\s*\(?[A-Z]*\)?\s*No\b/i,
    /\bin the (?:supreme|high) court\b|\breportable\b|\bjudgment\s*$|\border\s*$/i,
    /\bdate of (?:decision|judgment|order)\b|\bappellants?\b.*\brespondents?\b.*\bcounsel\b/i,
  ],
  facts: [
    /\b(?:brief )?facts\b|\bfactual (?:matrix|background)\b|\bbackground\b/i,
    /\b(?:was|were) (?:filed|lodged|registered|admitted|born|married|arrested|employed|appointed|convicted|acquitted|injured|sentenced)\b/i,
    /\b(?:the )?(?:prosecution|complainant|appellant|petitioner|respondent|plaintiff|defendant)\b.{0,40}\b(?:case|alleged|stated|claimed|filed|purchased|booked)\b/i,
    /\bFIR\b|\bchargesheet\b|\bon\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\bon the (?:fateful )?(?:day|night)\b/i,
    /\bthe (?:trial court|high court|tribunal|district forum|commission) (?:vide|by|had)\b|\bthe case of the\b/i,
  ],
  issues: [
    /\bquestions?\b.{0,30}\b(?:for consideration|arises?|falls?|to be (?:decided|determined))\b/i,
    /\b(?:issues?|points?) (?:for|that|which) (?:determination|consideration|arise|falls?)\b/i,
    /\bthe (?:short|only|main|core)?\s*(?:question|issue|point)\b.{0,40}\bwhether\b/i,
    /\bwhether\b.{0,200}\?/i,
    /\bframed the following (?:issues?|questions?)\b|\bfollowing (?:issues?|questions?|points?)\b/i,
  ],
  arguments: [
    /\blearned (?:senior )?(?:counsel|advocate|attorney)\b|\bshri\b.{0,40}\bappearing\b/i,
    /\b(?:submitted|contended|argued|urged|canvassed|pleaded) that\b|\bit was (?:submitted|contended|argued|urged)\b/i,
    /\bon the other hand\b|\bper contra\b|\bcounsel for the\b/i,
    /\bsubmissions?\b|\bheard (?:the )?learned\b/i,
  ],
  reasoning: [
    /\bwe (?:are of the (?:considered )?(?:view|opinion)|find|hold|are unable|are satisfied|may notice|may refer)\b/i,
    /\bin our (?:considered )?(?:view|opinion)\b|\bin the (?:facts|light) of\b|\bthis court (?:has|had) (?:held|observed|laid)\b/i,
    /\b(?:the )?(?:ratio|principle|doctrine|test|precedent|settled (?:law|position))\b/i,
    /\bsection \d+[A-Za-z]?\b.{0,80}\b(?:provides|stipulates|mandates|reads|contemplates)\b|\b(?:held|observed|ruled) (?:that|in)\b/i,
    /\b(?:therefore|thus|hence|consequently|accordingly)\b|\bwe have (?:considered|perused|examined)\b|\bdoes not (?:merit|hold|survive)\b/i,
  ],
  decision: [
    /\b(?:appeal|petition|application|suit|revision|writ petition)s?\b.{0,60}\b(?:is|are|stands?) (?:accordingly )?(?:hereby )?(?:allowed|dismissed|disposed|partly allowed|set aside)\b/i,
    /\bin the result\b|\bwe (?:accordingly )?(?:allow|dismiss|set aside|quash|direct|order|remand|uphold)\b/i,
    /\bno (?:order )?as to costs\b|\bpending applications?\b|\bdisposed of\b|\bconviction (?:and sentence )?is (?:set aside|upheld|confirmed)\b/i,
    /\bthe (?:impugned )?(?:judgment|order|decree)\b.{0,60}\b(?:is|are|stands?) (?:hereby )?(?:set aside|quashed|upheld|confirmed|modified)\b/i,
    /\bcosts? of rs\b|\bwithin (?:a period of )?\w+ (?:weeks|months)\b|\bdirected to\b/i,
  ],
};

const ROLE_ORDER = ['header', 'facts', 'issues', 'arguments', 'reasoning', 'decision'] as const;

/** Rule scores per role for one paragraph; `index` and `firstNumbered` give the position prior. */
function score(p: Paragraph, index: number, firstNumbered: number): Map<SegmentRole, number> {
  const s = new Map<SegmentRole, number>();
  for (const role of ROLE_ORDER) {
    let n = 0;
    for (const re of RULES[role]) if (re.test(p.text)) n += 1;
    if (n > 0) s.set(role, n);
  }
  // Position prior: text before the first numbered paragraph is the header.
  if (firstNumbered > 0 && index < firstNumbered && p.number === null)
    s.set('header', (s.get('header') ?? 0) + 1.5);
  if (p.text.trim().length < 80 && !p.text.includes('.') && p.number === null)
    s.set('header', (s.get('header') ?? 0) + 1);
  return s;
}

/** A role and confidence per paragraph: rules first, then the sequence prior for unscored ones. */
export function classifyParagraphs(paragraphs: readonly Paragraph[]): RoleGuess[] {
  const firstNumbered = paragraphs.findIndex((p) => p.number !== null);
  const guesses: RoleGuess[] = [];
  const total = paragraphs.length;
  for (const [i, p] of paragraphs.entries()) {
    const scores = score(p, i, firstNumbered);
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const sum = ranked.reduce((acc, [, v]) => acc + v, 0);
    if (top) {
      let [role, value] = top;
      // A closing paragraph with an operative verb is the decision.
      if (role !== 'decision' && i >= total - 2 && scores.has('decision')) {
        role = 'decision';
        value = scores.get('decision') ?? value;
      }
      guesses.push({
        role,
        confidence: Math.min(1, (value / sum) * Math.min(1, 0.45 + value * 0.25)),
      });
      continue;
    }
    const prev = guesses[i - 1];
    // No cue: continue the previous role, or the last paragraph is the decision's tail.
    if (prev && prev.role !== 'header') guesses.push({ role: prev.role, confidence: 0.5 });
    else guesses.push({ role: i === 0 ? 'header' : 'facts', confidence: 0.3 });
  }
  return guesses;
}

/** What the resolver is asked: the paragraphs the rules were unsure of. */
export interface RoleQuestion {
  index: number;
  text: string;
  rule: SegmentRole;
}

export const roleReplySchema = z.object({
  roles: z
    .array(z.object({ index: z.number().int().min(0), role: z.enum(SEGMENT_ROLES) }))
    .max(200),
});

/** Answers the rhetorical role of each paragraph (the AI gateway in production). */
export interface RoleResolver {
  resolve(questions: readonly RoleQuestion[]): Promise<unknown>;
}

/** Roles per paragraph after the resolver; an invalid or missing reply keeps the rule roles. */
export async function resolveLowConfidence(
  paragraphs: readonly Paragraph[],
  guesses: readonly RoleGuess[],
  resolver: RoleResolver | undefined,
): Promise<{ roles: SegmentRole[]; asked: number }> {
  const roles = guesses.map((g) => g.role);
  if (!resolver) return { roles, asked: 0 };
  const questions: RoleQuestion[] = [];
  for (const [i, g] of guesses.entries()) {
    const p = paragraphs[i];
    if (g.confidence < ROLE_CONFIDENCE_THRESHOLD && p && p.text.trim() !== '')
      questions.push({ index: i, text: p.text.trim().slice(0, 1200), rule: g.role });
    if (questions.length >= MAX_RESOLVER_ITEMS) break;
  }
  if (questions.length === 0) return { roles, asked: 0 };
  let reply: z.infer<typeof roleReplySchema> | null = null;
  try {
    const parsed = roleReplySchema.safeParse(await resolver.resolve(questions));
    reply = parsed.success ? parsed.data : null;
  } catch {
    reply = null;
  }
  if (reply) {
    const asked = new Set(questions.map((q) => q.index));
    for (const r of reply.roles) if (asked.has(r.index)) roles[r.index] = r.role;
  }
  return { roles, asked: questions.length };
}

interface Piece {
  start: number;
  end: number;
}

/** Cut a paragraph over the limit at sentence ends (a long sentence is cut at whitespace). */
function splitOversize(text: string, p: Piece): Piece[] {
  const maxChars = MAX_SEGMENT_TOKENS * 4;
  if (p.end - p.start <= maxChars) return [p];
  const pieces: Piece[] = [];
  let start = p.start;
  while (p.end - start > maxChars) {
    const window = text.slice(start, start + maxChars);
    const sentence = [...window.matchAll(/[.?!]["')\]]?\s+/g)].pop();
    const space = window.lastIndexOf(' ');
    const cut =
      sentence && sentence.index + sentence[0].length > maxChars / 3
        ? sentence.index + sentence[0].length
        : space > 0
          ? space + 1
          : maxChars;
    pieces.push({ start, end: start + cut });
    start += cut;
  }
  pieces.push({ start, end: p.end });
  return pieces;
}

/** Segments that tile `text`, never crossing a role boundary, sized 300-600 tokens where the role allows. */
export function packSegments(
  pages: readonly SegmentPage[],
  paragraphs: readonly Paragraph[],
  roles: readonly SegmentRole[],
): Segment[] {
  const text = fullText(pages);
  const pageStarts: number[] = [];
  let offset = 0;
  for (const p of pages) {
    pageStarts.push(offset);
    offset += p.text.length + 1;
  }
  const pageAt = (index: number): number => {
    let found = 0;
    for (const [i, s] of pageStarts.entries()) if (s <= index) found = i;
    return pages[found]?.pageNo ?? 1;
  };
  const segments: Segment[] = [];
  const emit = (role: SegmentRole, start: number, end: number) => {
    const body = text.slice(start, end);
    const lastChar = start + body.trimEnd().length - 1;
    segments.push({
      ordinal: segments.length + 1,
      role,
      pageFrom: pageAt(start),
      pageTo: pageAt(Math.max(start, lastChar)),
      text: body,
    });
  };
  let cur: { role: SegmentRole; start: number; end: number } | null = null;
  const flush = () => {
    if (cur) emit(cur.role, cur.start, cur.end);
    cur = null;
  };
  for (const [i, para] of paragraphs.entries()) {
    const role = roles[i] ?? 'other';
    for (const piece of splitOversize(text, para)) {
      if (cur && cur.role === role) {
        const merged = estimateTokens(text.slice(cur.start, piece.end));
        if (merged <= MAX_SEGMENT_TOKENS) {
          cur.end = piece.end;
          continue;
        }
        flush();
      } else flush();
      cur = { role, start: piece.start, end: piece.end };
    }
  }
  flush();
  return segments;
}

/** Segment a judgment with rules only. */
export function segmentJudgment(pages: readonly SegmentPage[]): Segment[] {
  const paragraphs = splitParagraphs(fullText(pages));
  const guesses = classifyParagraphs(paragraphs);
  return packSegments(
    pages,
    paragraphs,
    guesses.map((g) => g.role),
  );
}

/** Segment a judgment, sending low-confidence paragraphs to the resolver. */
export async function segmentJudgmentWithResolver(
  pages: readonly SegmentPage[],
  resolver: RoleResolver | undefined,
): Promise<{ segments: Segment[]; asked: number }> {
  const paragraphs = splitParagraphs(fullText(pages));
  const guesses = classifyParagraphs(paragraphs);
  const { roles, asked } = await resolveLowConfidence(paragraphs, guesses, resolver);
  return { segments: packSegments(pages, paragraphs, roles), asked };
}
