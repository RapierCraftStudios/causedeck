// Feed text to plain text (#481). Only the feed's own excerpt is kept, tags stripped and capped, so
// no full article body reaches the database even when a feed puts one in `description`.
import { schema } from '@causedeck/db';

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code =
        entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Strip markup, decode entities, collapse whitespace and cap at `max` characters. */
export function toExcerpt(
  raw: string | null | undefined,
  max = schema.NEWS_EXCERPT_MAX,
): string | null {
  if (raw === null || raw === undefined) return null;
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Entities first so escaped markup (`&lt;p&gt;`) is stripped too.
  const text = decodeEntities(decodeEntities(unwrapped).replace(/<[^>]*>/g, ' '))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  const chars = Array.from(text);
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** A headline: plain text on one line. */
export function toTitle(raw: string): string {
  return toExcerpt(raw, 300) ?? '';
}
