// HTML to text for email bodies (#528). Markup is dropped, never rendered: scripts, styles, images
// (tracking pixels) and links are removed without being fetched or followed, so reading a message
// makes no network request.
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
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
      const hex = body[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const BLOCK_TAGS = /<\/?(?:p|div|br|tr|li|ul|ol|table|h[1-6]|blockquote|hr|pre|section)\b[^>]*>/gi;

/** Plain text of an HTML body: no tags, no remote content, whitespace collapsed per line. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:img|link|iframe|object|embed|video|audio|source)\b[^>]*>/gi, '')
    .replace(/<\/(?:td|th)\s*>/gi, ' ')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
