// The style settings (#902): explicit settings the lawyer chose, never inferred or learned. Applying
// it is a pure transform over a block tree that touches only heading text, heading numbering, the
// salutation paragraph and the prayer wording selections; defaults leave every block unchanged.
import type { Block } from '@causedeck/validators/drafting';

export const HEADING_STYLES = ['as_written', 'upper', 'title'] as const;
export const NUMBERINGS = ['none', 'decimal', 'roman'] as const;

/** The paragraph block that holds the salutation (e.g. "To, The Hon'ble Court"). */
export const SALUTATION_BLOCK_ID = 'salutation';

export interface PrayerWording {
  /** The exact paragraph text the lawyer approved to be replaced. */
  from: string;
  to: string;
}

export interface StyleSettings {
  headingStyle: (typeof HEADING_STYLES)[number];
  /** Numbering prefix for top-level (level 1) headings. */
  numbering: (typeof NUMBERINGS)[number];
  /** Replaces the text of the salutation block; null keeps the template's. */
  salutation: string | null;
  prayerWording: readonly PrayerWording[];
}

export const DEFAULT_STYLE_SETTINGS: StyleSettings = {
  headingStyle: 'as_written',
  numbering: 'none',
  salutation: null,
  prayerWording: [],
};

const KEYS = ['headingStyle', 'numbering', 'salutation', 'prayerWording'];
const MAX_TEXT = 1000;
const MAX_WORDINGS = 20;

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_TEXT;
}

/** Parse stored settings strictly: unknown keys or values are refused, missing ones default. */
export function parseStyleSettings(input: unknown): StyleSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('A style profile is an object');
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) throw new TypeError(`Unknown style setting: ${key}`);
  }
  const headingStyle = raw.headingStyle ?? DEFAULT_STYLE_SETTINGS.headingStyle;
  const numbering = raw.numbering ?? DEFAULT_STYLE_SETTINGS.numbering;
  if (!HEADING_STYLES.includes(headingStyle as StyleSettings['headingStyle'])) {
    throw new TypeError('Unknown heading style');
  }
  if (!NUMBERINGS.includes(numbering as StyleSettings['numbering'])) {
    throw new TypeError('Unknown numbering');
  }
  const salutation = raw.salutation ?? null;
  if (salutation !== null && !isText(salutation)) throw new TypeError('Invalid salutation');
  const wording = raw.prayerWording ?? [];
  if (!Array.isArray(wording) || wording.length > MAX_WORDINGS) {
    throw new TypeError('Invalid prayer wording');
  }
  const prayerWording = wording.map((entry: unknown): PrayerWording => {
    const pair = entry as Record<string, unknown> | null;
    if (typeof pair !== 'object' || pair === null || !isText(pair.from) || !isText(pair.to)) {
      throw new TypeError('Invalid prayer wording');
    }
    return { from: pair.from, to: pair.to };
  });
  return {
    headingStyle: headingStyle as StyleSettings['headingStyle'],
    numbering: numbering as StyleSettings['numbering'],
    salutation,
    prayerWording,
  };
}

/** Rebuild a block tree bottom-up with `fn`; blocks `fn` returns unchanged keep their identity. */
export function mapBlocks(blocks: readonly Block[], fn: (block: Block) => Block): Block[] {
  return blocks.map((block) => {
    if (block.type === 'section' || block.type === 'list') {
      const children = mapBlocks(block.children, fn);
      const changed = children.some((child, i) => child !== block.children[i]);
      return fn(changed ? { ...block, children } : block);
    }
    return fn(block);
  });
}

function toRoman(n: number): string {
  const table: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rest = n;
  let out = '';
  for (const [value, glyph] of table) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

const NUMBERED = /^(\d+|[IVXLC]+)\.\s/;

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, space: string, c: string) => {
    return space + c.toUpperCase();
  });
}

export function applyStyleSettings(blocks: readonly Block[], profile: StyleSettings): Block[] {
  const wording = new Map(profile.prayerWording.map((w) => [w.from, w.to]));
  let heading = 0;
  // Numbering follows document order, so walk once in order before the structural map.
  const numberOf = new Map<Block, string>();
  const visit = (list: readonly Block[]): void => {
    for (const block of list) {
      if (block.type === 'heading' && block.level === 1) {
        heading += 1;
        numberOf.set(block, profile.numbering === 'roman' ? toRoman(heading) : String(heading));
      }
      if (block.type === 'section' || block.type === 'list') visit(block.children);
    }
  };
  if (profile.numbering !== 'none') visit(blocks);

  return mapBlocks(blocks, (block) => {
    if (block.type === 'heading') {
      let text = block.text;
      if (profile.headingStyle === 'upper') text = text.toUpperCase();
      if (profile.headingStyle === 'title') text = titleCase(text);
      const number = numberOf.get(block);
      if (number !== undefined && !NUMBERED.test(text)) text = `${number}. ${text}`;
      return text === block.text ? block : { ...block, text };
    }
    if (block.type === 'paragraph') {
      if (profile.salutation !== null && block.id === SALUTATION_BLOCK_ID) {
        return profile.salutation === block.text ? block : { ...block, text: profile.salutation };
      }
      const to = wording.get(block.text);
      if (to !== undefined) return { ...block, text: to };
    }
    return block;
  });
}
