// `no-direct-listing-update` (#364, part 3 of #33; ADR 0016): only matter-graph/next-date.ts may
// write a listing's date or its canonical flag in packages/core, so the canonical next date changes
// through `confirmNextDate` alone. Every non-test module under packages/core/src is scanned for a
// Drizzle update of `listing` whose `set` names `listDate` or `canonical`, a Drizzle insert into
// `listing` whose values name `canonical`, and raw SQL updating `list_date` or `canonical`.
// Deletes stay allowed: the lifecycle erase purges listing rows (lifecycle/deletion/erase.ts).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../..');
const ALLOWED = 'matter-graph/next-date.ts';

/** Every non-test TypeScript module under packages/core/src, relative to it. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !/\.test\.ts$/.test(entry.name)
      ? [path.relative(SRC, full).split(path.sep).join('/')]
      : [];
  });
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The names `listing` goes by in `text`: itself, `schema.listing` and local aliases. */
function listingNames(text: string): string[] {
  const names = new Set(['listing', 'schema.listing']);
  for (const m of text.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*schema\.listing\b/g)) {
    if (m[1]) names.add(m[1]);
  }
  for (const m of text.matchAll(/\{([^{}]*)\}\s*=\s*schema\b/g)) {
    for (const alias of (m[1] ?? '').matchAll(/\blisting\s*:\s*(\w+)/g)) {
      if (alias[1]) names.add(alias[1]);
    }
  }
  return [...names];
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** The `line: snippet` of every write of a listing date or canonical flag in `text`. */
function directListingWrites(text: string): string[] {
  const hits: { index: number; what: string }[] = [];
  const names = listingNames(text).map(escape).join('|');
  const statementFrom = (index: number) => {
    const end = text.indexOf(';', index);
    return text.slice(index, end === -1 ? undefined : end);
  };
  for (const m of text.matchAll(new RegExp(`\\.update\\(\\s*(?:${names})\\s*\\)`, 'g'))) {
    const statement = statementFrom(m.index);
    const set = statement.slice(statement.indexOf('.set('));
    if (statement.includes('.set(') && /\b(listDate|canonical)\b\s*:/.test(set)) {
      hits.push({ index: m.index, what: 'drizzle update of listDate/canonical' });
    }
  }
  for (const m of text.matchAll(new RegExp(`\\.insert\\(\\s*(?:${names})\\s*\\)`, 'g'))) {
    if (/\bcanonical\b\s*:/.test(statementFrom(m.index))) {
      hits.push({ index: m.index, what: 'drizzle insert with canonical' });
    }
  }
  const rawUpdate =
    /\bupdate\s+(?:"?public"?\.)?(?:"?listing"?|\$\{\s*(?:schema\.)?listing\s*\})\s+set\b[^;`]*?(?:\blist_date\b|\bcanonical\b|\$\{\s*(?:schema\.)?listing\.(?:listDate|canonical)\s*\})/gi;
  for (const m of text.matchAll(rawUpdate)) {
    hits.push({ index: m.index, what: 'raw SQL update of list_date/canonical' });
  }
  return hits
    .sort((a, b) => a.index - b.index)
    .map(({ index, what }) => `${String(lineOf(text, index))}: ${what}`);
}

describe('no-direct-listing-update', () => {
  it('flags date and canonical writes, and allows deletes and other columns', () => {
    const flagged = [
      `await tx.update(listing).set({ listDate: '2026-11-02' }).where(eq(listing.id, id));`,
      `await tx.update(schema.listing).set({ canonical: true }).where(eq(schema.listing.id, id));`,
      `const { listing: l } = schema;\nawait tx.update(l).set({ listDate: d }).where(x);`,
      `const l = schema.listing;\nawait tx.update(l).set({ canonical: false });`,
      `await tx.insert(listing).values({ listDate: d, canonical: true });`,
      'await tx.execute(sql`update listing set list_date = ${d} where id = ${id}`);',
      'await tx.execute(sql`UPDATE "public"."listing" SET "canonical" = false`);',
      'await tx.execute(sql`update ${listing} set ${listing.listDate} = ${d}`);',
    ];
    for (const snippet of flagged) expect(directListingWrites(snippet), snippet).not.toEqual([]);
    const allowed = [
      `await tx.delete(listing).where(eq(listing.workspaceId, ws));`,
      'await tx.execute(sql`delete from listing where workspace_id = ${ws}`);',
      `await tx.update(listing).set({ hallId: h, itemNo: '12' }).where(eq(listing.id, id));`,
      `await tx.insert(listing).values({ listDate: d, stageRaw: '' });`,
      `await tx.select().from(listing).where(eq(listing.canonical, true));`,
      `await tx.update(hearing).set({ nextDateConfirmed: d });`,
    ];
    for (const snippet of allowed) expect(directListingWrites(snippet), snippet).toEqual([]);
  });

  it('finds the writes of next-date.ts, so the scan is not vacuous', () => {
    const files = sourceFiles();
    expect(files).toContain(ALLOWED);
    expect(files).toContain('lifecycle/deletion/erase.ts');
    expect(directListingWrites(readFileSync(path.join(SRC, ALLOWED), 'utf8'))).not.toEqual([]);
  });

  it('lets no other packages/core module write a listing date or canonical flag', () => {
    const offending = sourceFiles()
      .filter((file) => file !== ALLOWED)
      .flatMap((file) =>
        directListingWrites(readFileSync(path.join(SRC, file), 'utf8')).map(
          (hit) => `${file}:${hit}`,
        ),
      );
    expect(offending).toEqual([]);
  });
});
