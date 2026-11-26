// The research query router (#1174): a fact pattern stays facts; a neutral citation, a case number and
// a CNR of a stored judgment route to it; `483 BNSS` routes to the section with its CrPC 439
// counterpart; an unknown section or an unstored citation falls back to facts. Negative examples: fact
// descriptions that mention a section or a year are not citations.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { schema, type Transaction } from '@causedeck/db';
import { createDb, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUser, newWorkspace } from '../__tests__/fixtures.ts';

import { classifyResearchQuery, detectReference } from './query-router.ts';

const { statuteAct, statuteSection, statuteSectionVersion } = schema;
// Statute tables are global and written by the owner role, as in the statutes tests.
const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
const created = { acts: [] as string[], sections: [] as string[] };

async function ensureAct(key: string, title: string, shortName: string): Promise<string> {
  const [inserted] = await owner
    .insert(statuteAct)
    .values({
      key,
      title,
      shortName,
      inForceFrom: '1974-04-01',
      sourceNote: 'synthetic test fixture (#1174)',
      synthetic: true,
    })
    .onConflictDoNothing()
    .returning({ id: statuteAct.id });
  if (inserted !== undefined) {
    created.acts.push(inserted.id);
    return inserted.id;
  }
  const [row] = await owner
    .select({ id: statuteAct.id })
    .from(statuteAct)
    .where(eq(statuteAct.key, key));
  if (row === undefined) throw new Error(`act ${key} missing`);
  return row.id;
}

async function ensureSection(actId: string, section: string, heading: string): Promise<void> {
  const [inserted] = await owner
    .insert(statuteSection)
    .values({ actId, section, heading })
    .onConflictDoNothing()
    .returning({ id: statuteSection.id });
  if (inserted === undefined) return;
  created.sections.push(inserted.id);
  await owner.insert(statuteSectionVersion).values({
    sectionId: inserted.id,
    text: `${heading}.`,
    validFrom: '1974-04-01',
    validTo: null,
    sourceNote: 'synthetic test fixture (#1174)',
    synthetic: true,
  });
}

beforeAll(async () => {
  const crpc = await ensureAct('code of criminal procedure', 'Code of Criminal Procedure', 'CrPC');
  const bnss = await ensureAct(
    'bharatiya nagarik suraksha sanhita',
    'Bharatiya Nagarik Suraksha Sanhita',
    'BNSS',
  );
  await ensureSection(crpc, '439', 'Special powers of High Court regarding bail');
  await ensureSection(bnss, '483', 'Special powers of High Court regarding bail');
});

afterAll(async () => {
  if (created.sections.length > 0) {
    await owner.delete(statuteSection).where(inArray(statuteSection.id, created.sections));
  }
  if (created.acts.length > 0) {
    await owner.delete(statuteAct).where(inArray(statuteAct.id, created.acts));
  }
  await owner.$client.end();
});

async function seedJudgment(
  tx: Transaction,
  v: { neutral: string; caseNumbers: string[]; title: string; titleMasked?: boolean },
): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      neutralCitation: v.neutral,
      caseNumbers: v.caseNumbers,
      judgmentDate: '2024-03-04',
      provenance: {
        url: `https://court.example/${sha256}.pdf`,
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [{ pageNo: 1, text: 'Raw.' }],
      redactedText: [{ pageNo: 1, text: 'Redacted.' }],
      redactionVersion: 1,
      caseTitle: v.title,
      titleMasked: v.titleMasked ?? false,
    })
    .returning({ id: schema.judgment.id });
  return row?.id ?? '';
}

async function actorOf(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  return { workspaceId, userId: ownerId };
}

describe('detectReference', () => {
  it('reads citations, sections and CNRs, and leaves fact descriptions alone', () => {
    expect(detectReference('483 BNSS')).toMatchObject({ kind: 'section', normalized: 'BNSS s 483' });
    expect(detectReference('BNSS 483')).toMatchObject({ kind: 'section' });
    expect(detectReference('s. 439 CrPC')).toMatchObject({ kind: 'section', normalized: 'CRPC s 439' });
    expect(detectReference('2024:MHC:1234')).toMatchObject({ kind: 'neutral' });
    expect(detectReference('W.P.No.1234 of 2025')).toMatchObject({
      kind: 'case_number',
      normalized: 'WP 1234/2025',
    });
    expect(detectReference('MHHC01-001234-2024')).toEqual({
      kind: 'cnr',
      normalized: 'MHHC010012342024',
    });
    // Negative examples: a fact pattern that mentions a section, a year or a number is facts.
    for (const facts of [
      'bail for commercial quantity under section 37 NDPS after two years in custody',
      'regular bail under s. 483 BNSS where the accused has been in custody for a year',
      'accused arrested in 2023 and released on bail',
      'surgery without consent',
      'MHHC0100123420', // too short for a CNR
      '1234567890123456', // digits only, no state code
    ]) {
      expect(detectReference(facts)).toBeNull();
    }
  });
});

describe('classifyResearchQuery', () => {
  it('routes facts, a neutral citation, a case number and a CNR', async () => {
    await withTestDb(async (tx) => {
      const no = String(100000 + Math.floor(Math.random() * 800000));
      const cnr = `MHHC01${no.padStart(6, '0')}2024`;
      const judgmentId = await seedJudgment(tx, {
        neutral: `2024:MHC:${no}`,
        caseNumbers: [`W.P.No.${no} of 2024`, `${cnr.slice(0, 6)}-${cnr.slice(6, 12)}-2024`],
        title: 'X v. State',
        titleMasked: true,
      });
      const actor = await actorOf(tx);
      expect(await classifyResearchQuery(tx, actor, { query: 'surgery without consent' })).toEqual(
        { kind: 'facts', query: 'surgery without consent' },
      );
      const expected = {
        judgmentId,
        title: 'X v. State',
        titleMasked: true,
        neutralCitation: `2024:MHC:${no}`,
        court: 'MHC',
        judgmentDate: '2024-03-04',
        readable: true,
      };
      expect(await classifyResearchQuery(tx, actor, { query: `2024:MHC:${no}` })).toEqual({
        kind: 'citation',
        citationKind: 'neutral',
        normalized: `2024:MHC:${no}`,
        judgments: [expected],
      });
      expect(await classifyResearchQuery(tx, actor, { query: `W.P. No. ${no} of 2024` })).toEqual({
        kind: 'citation',
        citationKind: 'case_number',
        normalized: `WP ${no}/2024`,
        judgments: [expected],
      });
      expect(await classifyResearchQuery(tx, actor, { query: cnr.toLowerCase() })).toEqual({
        kind: 'citation',
        citationKind: 'cnr',
        normalized: cnr,
        judgments: [expected],
      });
      // A citation that is not stored is searched as facts.
      expect(
        await classifyResearchQuery(tx, actor, { query: '2019:KHC:999999' }),
      ).toMatchObject({ kind: 'facts' });
    });
  });

  it('routes 483 BNSS to the section with its CrPC 439 counterpart; an unknown one is facts', async () => {
    await withTestDb(async (tx) => {
      const actor = await actorOf(tx);
      const route = await classifyResearchQuery(tx, actor, { query: '483 BNSS' });
      expect(route).toMatchObject({
        kind: 'section',
        section: { statute: 'bharatiya nagarik suraksha sanhita', section: '483', shortName: 'BNSS' },
        counterparts: [{ statute: 'code of criminal procedure', section: '439', shortName: 'CrPC' }],
      });
      expect(await classifyResearchQuery(tx, actor, { query: 's. 9999 BNSS' })).toEqual({
        kind: 'facts',
        query: 's. 9999 BNSS',
      });
    });
  });

  it('refuses a non-member and an empty query', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await newWorkspace(tx);
      const stranger = await newUser(tx);
      await expect(
        classifyResearchQuery(tx, { workspaceId, userId: stranger }, { query: '483 BNSS' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        classifyResearchQuery(tx, { workspaceId, userId: stranger }, { query: '  ' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });
});
