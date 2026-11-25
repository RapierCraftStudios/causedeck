// The copilot's written answer as light markdown (#1192). The model sometimes formats its answer
// (`**bold**`, `- ` lists) and sometimes not; the same question must read the same way either way, so
// the formatting is rendered, never shown as raw `**` or `- `. Supported: paragraphs, `**bold**`,
// `*italic*`, `` `code` ``, `-`/`*`/`•` and `1.` lists, and `#` headings (shown as a bold line).
// Sanitised by construction: the text only ever becomes React text nodes inside a fixed set of
// elements (no dangerouslySetInnerHTML, raw HTML stays inert text, links are not rendered). `[n]` and
// `[n, m]` markers become citations through `renderCite`, only for n in 1..claimCount (a verified
// claim, D-004); any other number in a marker is dropped, and a marker left with none disappears.
import { Fragment, type ReactNode } from 'react';

/** A run of answer text, or a citation of verified claim `n` (1-based). */
export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; n: number };

/** `[1]`, `[1, 2]` with the whitespace before it (removed with the marker). */
const MARKER = /\s*\[\s*(\d{1,3}(?:\s*,\s*\d{1,3})*)\s*\]/g;

/**
 * Splits text into runs and citations. A marker keeps only its numbers that name a verified claim
 * (deduplicated); the marker and the space before it are removed in every case, so it never shows.
 */
export function splitCitations(text: string, claimCount: number): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  const pushText = (run: string) => {
    if (run === '') return;
    const prev = parts.at(-1);
    if (prev?.kind === 'text') prev.text += run;
    else parts.push({ kind: 'text', text: run });
  };
  for (const match of text.matchAll(MARKER)) {
    pushText(text.slice(last, match.index));
    last = match.index + match[0].length;
    const ns = new Set((match[1] ?? '').split(',').map((n) => Number(n.trim())));
    for (const n of ns) if (n >= 1 && n <= claimCount) parts.push({ kind: 'cite', n });
  }
  pushText(text.slice(last));
  return parts;
}

type Block = { kind: 'p'; text: string; strong: boolean } | { kind: 'ul' | 'ol'; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** Lines to blocks: blank lines end a paragraph; consecutive bullet or numbered lines are a list. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length > 0) blocks.push({ kind: 'p', text: para.join(' '), strong: false });
    para = [];
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const heading = HEADING.exec(line);
    if (bullet !== null || numbered !== null) {
      endPara();
      const kind = bullet === null ? 'ol' : 'ul';
      const item = (bullet ?? numbered)?.[1]?.trim() ?? '';
      const prev = blocks.at(-1);
      if (prev !== undefined && prev.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (heading !== null) {
      endPara();
      blocks.push({ kind: 'p', text: heading[1]?.trim() ?? '', strong: true });
    } else if (line.trim() === '') {
      endPara();
    } else {
      // A wrapped continuation of the last list item stays in that item.
      const prev = blocks.at(-1);
      if (para.length === 0 && prev !== undefined && prev.kind !== 'p' && /^\s+\S/.test(line)) {
        const at = prev.items.length - 1;
        prev.items[at] = `${prev.items[at] ?? ''} ${line.trim()}`;
      } else {
        para.push(line.trim());
      }
    }
  }
  endPara();
  return blocks.filter((b) => (b.kind === 'p' ? b.text !== '' : b.items.length > 0));
}

/** `code`, then **bold**, then *italic* (not a lone `*` or one inside a word). */
const INLINE =
  /`([^`\n]+)`|\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=\S)\*(?![\w*])/g;

type CiteRenderer = (n: number, key: string) => ReactNode;

function inline(text: string, claimCount: number, cite: CiteRenderer, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const plain = (run: string, k: string) => {
    // Text with its citations; an unmatched `**` left by a cut-off reply is dropped, never shown.
    for (const [i, part] of splitCitations(run.replace(/\*\*/g, ''), claimCount).entries()) {
      out.push(
        part.kind === 'text' ? (
          <Fragment key={`${k}.${String(i)}`}>{part.text}</Fragment>
        ) : (
          cite(part.n, `${k}.${String(i)}`)
        ),
      );
    }
  };
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE)) {
    plain(text.slice(last, match.index), `${key}.t${String(i)}`);
    last = match.index + match[0].length;
    const k = `${key}.m${String(i)}`;
    if (match[1] !== undefined) {
      out.push(
        <code key={k} className="bg-surface-sunken rounded-sm px-1 font-mono text-[0.9em]">
          {match[1]}
        </code>,
      );
    } else if (match[2] !== undefined) {
      out.push(
        <strong key={k} className="font-semibold">
          {inline(match[2], claimCount, cite, k)}
        </strong>,
      );
    } else {
      out.push(<em key={k}>{inline(match[3] ?? '', claimCount, cite, k)}</em>);
    }
    i += 1;
  }
  plain(text.slice(last), `${key}.t${String(i)}`);
  return out;
}

/** One line of answer text (no blocks): the bottom line. */
export function InlineMarkdown({
  text,
  claimCount,
  renderCite,
}: {
  text: string;
  claimCount: number;
  renderCite: CiteRenderer;
}) {
  return <>{inline(text.replace(/\s*\n\s*/g, ' '), claimCount, renderCite, 'i')}</>;
}

/** The written answer as paragraphs and lists. */
export function AnswerMarkdown({
  text,
  claimCount,
  renderCite,
}: {
  text: string;
  claimCount: number;
  renderCite: CiteRenderer;
}) {
  return (
    <>
      {parseBlocks(text).map((block, b) => {
        const key = `b${String(b)}`;
        if (block.kind === 'p') {
          const content = inline(block.text, claimCount, renderCite, key);
          return (
            <p key={key} className={block.strong ? 'font-semibold' : undefined}>
              {content}
            </p>
          );
        }
        const items = block.items.map((item, n) => (
          <li key={`${key}.${String(n)}`} className="ps-1">
            {inline(item, claimCount, renderCite, `${key}.${String(n)}`)}
          </li>
        ));
        return block.kind === 'ul' ? (
          <ul key={key} className="list-disc space-y-1 ps-5">
            {items}
          </ul>
        ) : (
          <ol key={key} className="list-decimal space-y-1 ps-5">
            {items}
          </ol>
        );
      })}
    </>
  );
}
