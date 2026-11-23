// createCorpusResolver (#1135) over a real database, driven through drafting's extraction and
// `checkCitations`/`classify`: case numbers through `judgment.case_numbers`, neutral citations,
// sections through the statutes layer, pinpoints and quotes, reporter citations never verified, and
// no judgment text, quote or title written to audit or logs.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { createDb, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { checkCitations, extractFromText } from '@causedeck/drafting';
import { statuteKey } from '@causedeck/intelligence';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCorpusResolver } from './corpus-resolver.ts';

const { judgment, statuteAct, statuteSection, statuteSectionVersion } = schema;
const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
const created = { acts: [] as string[], sections: [] as string[] };

const QUOTE = 'the duty of care is owed to every passenger';
const MASKED = 'X v. State of Tamil Nadu';

/** BNS s 106, committed by the owner unless already stored; afterAll removes only what it added. */
beforeAll(async () => {
  const key = statuteKey('BNS');
  const [inserted] = await owner
    .insert(statuteAct)
    .values({
      key,
      title: 'Bharatiya Nyaya Sanhita, 2023',
      shortName: 'BNS',
      inForceFrom: '2024-07-01',
      sourceNote: 'synthetic test fixture (#1135)',
      synthetic: true,
    })
    .onConflictDoNothing()
    .returning({ id: statuteAct.id });
  if (inserted !== undefined) created.acts.push(inserted.id);
  const [act] = await owner
    .select({ id: statuteAct.id })
    .from(statuteAct)
    .where(eq(statuteAct.key, key));
  if (act === undefined) throw new Error('BNS missing');
  const [section] = await owner
    .insert(statuteSection)
    .values({ actId: act.id, section: '106', heading: 'Causing death by negligence' })
    .onConflictDoNothing()
    .returning({ id: statuteSection.id });
  if (section !== undefined) {
    created.sections.push(section.id);
    await owner.insert(statuteSectionVersion).values({
      sectionId: section.id,
      text: 'Synthetic text.',
      validFrom: '2024-07-01',
      validTo: null,
      sourceNote: 'synthetic test fixture (#1135)',
      synthetic: true,
    });
  }
});

afterAll(async () => {
  for (const id of created.sections) {
    await owner.delete(statuteSectionVersion).where(eq(statuteSectionVersion.sectionId, id));
    await owner.delete(statuteSection).where(eq(statuteSection.id, id));
  }
  for (const id of created.acts) await owner.delete(statuteAct).where(eq(statuteAct.id, id));
  await owner.$client.end();
});

async function seedJudgment(
  tx: Transaction,
  { caseNumbers = [] as string[], neutralCitation = null as string | null } = {},
): Promise<{ id: string; url: string }> {
  const url = `https://mhc.example/j/${randomUUID()}.pdf`;
  const [row] = await tx
    .insert(judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      neutralCitation,
      sha256: randomUUID().replaceAll('-', ''),
      provenance: {
        url,
        fetchedAt: '2026-11-01T00:00:00.000Z',
        sha256: 'r',
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      caseNumbers,
      caseTitle: MASKED,
      titleMasked: true,
      pageText: [{ pageNo: 1, text: `${neutralCitation ?? ''}\n1. Raw.\n2. Raw ${QUOTE}.` }],
      redactedText: [{ pageNo: 1, text: `1. The facts.\n2. We hold that ${QUOTE}.` }],
    })
    .returning({ id: judgment.id });
  if (row === undefined) throw new Error('not inserted');
  return { id: row.id, url };
}

async function check(tx: Transaction, text: string) {
  const resolver = createCorpusResolver({ db: tx });
  return checkCitations(extractFromText(text, 'b1'), { resolver, workspaceId: randomUUID() });
}

describe('createCorpusResolver', () => {
  it('is an in-process CitationResolver named corpus', () => {
    const resolver = createCorpusResolver();
    expect(resolver.name).toBe('corpus');
    expect(resolver.external).toBe(false);
  });

  it('resolves a case number through judgment.case_numbers as printed, with the masked title', async () => {
    await withTestDb(async (tx) => {
      const no = String(800000 + Math.floor(Math.random() * 99999));
      const j = await seedJudgment(tx, { caseNumbers: [`W.P.No.${no} of 2026`] });
      const resolver = createCorpusResolver({ db: tx });
      const outcome = await resolver.resolve({ normalized: `WP ${no}/2026`, kind: 'case_number' });
      expect(outcome).toEqual({
        kind: 'hits',
        hits: [{ citation: `WP ${no}/2026`, title: MASKED, titleMasked: true, sourceUrl: j.url }],
      });
      const [hit] = await check(tx, `As held in W.P. No. ${no} of 2026, the writ lies.`);
      expect(hit?.verdict).toMatchObject({ status: 'verified', sourceUrl: j.url });
      // Another year or number is not a hit.
      expect(await resolver.resolve({ normalized: `WP ${no}/2025`, kind: 'case_number' })).toEqual({
        kind: 'hits',
        hits: [],
      });
      const [miss] = await check(tx, `See W.P. No. ${no}1 of 2026.`);
      expect(miss?.verdict.status).toBe('not_found');
    });
  });

  it('resolves a neutral citation through verifyCitation without page anchors', async () => {
    await withTestDb(async (tx) => {
      const citation = `2026:MHC:${String(900000 + Math.floor(Math.random() * 99999))}`;
      const j = await seedJudgment(tx, { neutralCitation: citation });
      const outcome = await createCorpusResolver({ db: tx }).resolve({
        normalized: citation,
        kind: 'neutral',
      });
      expect(outcome).toEqual({
        kind: 'hits',
        hits: [{ citation, title: MASKED, titleMasked: true, sourceUrl: j.url }],
      });
      expect(JSON.stringify(outcome)).not.toContain('anchors');
    });
  });

  it('checks a pinpoint and quote through verifyPinpoint, with a distinct reason per failure', async () => {
    await withTestDb(async (tx) => {
      const no = String(600000 + Math.floor(Math.random() * 99999));
      await seedJudgment(tx, { caseNumbers: [`W.P.No.${no} of 2026`] });
      const cite = `W.P. No. ${no} of 2026`;
      const [ok] = await check(tx, `${cite}, para 2, "${QUOTE}".`);
      expect(ok?.verdict).toMatchObject({ status: 'verified', quoteChecked: 'verified' });
      const [wrongPara] = await check(tx, `${cite}, para 9, "${QUOTE}".`);
      expect(wrongPara?.verdict).toMatchObject({ status: 'unknown', reason: 'pinpoint_not_found' });
      const [altered] = await check(tx, `${cite}, para 2, "the duty is owed to nobody".`);
      expect(altered?.verdict).toMatchObject({ status: 'unknown', reason: 'quote_not_found' });
      const outcome = await createCorpusResolver({ db: tx }).resolve({
        normalized: `WP ${no}/2026`,
        kind: 'case_number',
        pinpoint: { para: 2 },
        quote: QUOTE,
      });
      expect(outcome).toMatchObject({ kind: 'hits', hits: [{ check: { quote: 'verified' } }] });
      // Statuses only: no paragraph or quote text leaves the resolver or the check.
      for (const value of [outcome, ok, wrongPara, altered]) {
        const json = JSON.stringify(value);
        expect(json).not.toContain('passenger');
        expect(json).not.toContain('We hold');
      }
    });
  });

  it('verifies a stored section and gives section_not_found for an unknown one', async () => {
    await withTestDb(async (tx) => {
      const [found] = await check(tx, 'The offence falls under s. 106 BNS.');
      expect(found?.kind).toBe('section');
      expect(found?.verdict.status).toBe('verified');
      const [unknown] = await check(tx, 'The offence falls under s. 9999 BNS.');
      expect(unknown?.verdict).toEqual({ status: 'not_found', reason: 'section_not_found' });
    });
  });

  it('never verifies a reporter citation: it stays unknown', async () => {
    await withTestDb(async (tx) => {
      const outcome = await createCorpusResolver({ db: tx }).resolve({
        normalized: '(2020) 5 SCC 1',
        kind: 'reporter',
      });
      expect(outcome).toEqual({ kind: 'unavailable' });
      const [reporter] = await check(tx, 'See (2020) 5 SCC 1.');
      if (reporter !== undefined) {
        expect(reporter.kind).toBe('reporter');
        expect(reporter.verdict.status).toBe('unknown');
      }
    });
  });

  it('writes nothing to audit or logs: no audit, logger or observability import', () => {
    for (const file of ['corpus-resolver.ts', 'verify-quote.ts']) {
      const source = readFileSync(path.join(import.meta.dirname, file), 'utf8');
      expect(source).not.toMatch(/from '[^']*(audit|logger|observability)[^']*'/);
      expect(source).not.toMatch(/console\./);
    }
  });
});
