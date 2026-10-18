// Palette search: NFC-normalised, case-insensitive fuzzy matching that works for Latin, Tamil and
// Kannada. Tamil and Kannada vowel signs can arrive precomposed or decomposed (கொ is U+0BCA or
// U+0BC6 U+0BBE), so text is normalised before comparing and subsequences step by grapheme.
import type { Command, CommandGroupId } from './types.ts';

export const SCORE = {
  prefix: 4,
  wordPrefix: 3,
  substring: 2,
  subsequence: 1,
  none: 0,
} as const;

export function normaliseText(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase();
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

function isSubsequence(needle: string[], haystack: string[]): boolean {
  let index = 0;
  for (const unit of haystack) {
    if (unit === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/** How well `query` matches `text`: exact prefix > word prefix > substring > subsequence > 0. */
export function scoreText(text: string, query: string): number {
  const q = normaliseText(query).trim();
  if (q === '') return SCORE.prefix;
  const t = normaliseText(text);
  if (t.startsWith(q)) return SCORE.prefix;
  if (t.split(/[\s\p{P}]+/u).some((word) => word.startsWith(q))) return SCORE.wordPrefix;
  if (t.includes(q)) return SCORE.substring;
  const needle = graphemes(q.replace(/\s+/gu, ''));
  return isSubsequence(needle, graphemes(t)) ? SCORE.subsequence : SCORE.none;
}

export type QueryMode = 'all' | 'commands' | 'navigation';

/** `>` limits the palette to commands, `/` to navigation; the prefix is not part of the query. */
export function parseQuery(raw: string): { mode: QueryMode; query: string } {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('>')) return { mode: 'commands', query: trimmed.slice(1).trim() };
  if (trimmed.startsWith('/')) return { mode: 'navigation', query: trimmed.slice(1).trim() };
  return { mode: 'all', query: raw.trim() };
}

export function inMode(group: CommandGroupId, mode: QueryMode): boolean {
  if (mode === 'navigation') return group === 'goTo';
  if (mode === 'commands') return group !== 'goTo';
  return true;
}

export interface RankedCommand {
  command: Command;
  score: number;
}

/**
 * Commands matching the raw palette input, best first; ties keep their original order.
 * `labelOf` translates a command's label (search runs on what the user sees, plus keywords).
 */
export function rankCommands(
  commands: readonly Command[],
  raw: string,
  labelOf: (command: Command) => string,
): RankedCommand[] {
  const { mode, query } = parseQuery(raw);
  return commands
    .filter((command) => inMode(command.group, mode))
    .map((command) => ({
      command,
      score: Math.max(
        scoreText(labelOf(command), query),
        ...(command.keywords ?? []).map((keyword) => scoreText(keyword, query)),
      ),
    }))
    .filter((entry) => entry.score > SCORE.none)
    .sort((a, b) => b.score - a.score);
}
