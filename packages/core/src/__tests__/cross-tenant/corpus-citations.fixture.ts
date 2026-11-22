// Seeds for the corpus citation cases (#1135): a redacted judgment with a printed case number,
// numbered paragraphs and a masked title (inserted in the rolled-back transaction), and a synthetic
// statute act and section committed by the owner (statute tables are SELECT-only for the app role)
// and removed again by `cleanup`.
import { randomUUID } from 'node:crypto';

import { schema, type Database, type Transaction } from '@causedeck/db';
import { eq } from 'drizzle-orm';

const { judgment, statuteAct, statuteSection, statuteSectionVersion } = schema;

export interface CorpusJudgmentSeed {
  id: string;
  caseNumber: string;
  normalizedCaseNumber: string;
  quote: string;
  sourceUrl: string;
}

/** A judgment whose para 2 holds `quote`; its title is masked and its case number printed raw. */
export async function seedCorpusJudgment(tx: Transaction): Promise<CorpusJudgmentSeed> {
  const no = String(700000 + Math.floor(Math.random() * 99999));
  const sourceUrl = `https://mhc.example/j/${no}.pdf`;
  const quote = 'the duty of care is owed to every passenger';
  const [row] = await tx
    .insert(judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256: randomUUID().replaceAll('-', ''),
      provenance: {
        url: sourceUrl,
        fetchedAt: '2026-11-01T00:00:00.000Z',
        sha256: 'xt',
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      caseNumbers: [`W.P.No.${no} of 2026`],
      caseTitle: 'X v. State',
      titleMasked: true,
      pageText: [{ pageNo: 1, text: `1. Facts.\n2. Raw page text ${quote}.` }],
      redactedText: [{ pageNo: 1, text: `1. Facts of the case.\n2. We hold that ${quote}.` }],
    })
    .returning({ id: judgment.id });
  if (row === undefined) throw new Error('judgment not inserted');
  return {
    id: row.id,
    caseNumber: `W.P.No.${no} of 2026`,
    normalizedCaseNumber: `WP ${no}/2026`,
    quote,
    sourceUrl,
  };
}

export interface StatuteSeed {
  statute: string;
  section: string;
  heading: string;
  cleanup: () => Promise<void>;
}

/** A synthetic act with one section, committed by the owner; `cleanup` deletes both. */
export async function seedStatute(owner: Database): Promise<StatuteSeed> {
  const statute = `xt act ${randomUUID().slice(0, 8)}`;
  const heading = 'Punishment for a synthetic offence';
  const [act] = await owner
    .insert(statuteAct)
    .values({
      key: statute,
      title: statute,
      shortName: null,
      inForceFrom: '2024-07-01',
      sourceNote: 'synthetic test fixture (#1135)',
      synthetic: true,
    })
    .returning({ id: statuteAct.id });
  if (act === undefined) throw new Error('act not inserted');
  const [section] = await owner
    .insert(statuteSection)
    .values({ actId: act.id, section: '106', heading })
    .returning({ id: statuteSection.id });
  if (section === undefined) throw new Error('section not inserted');
  await owner.insert(statuteSectionVersion).values({
    sectionId: section.id,
    text: 'Synthetic section text.',
    validFrom: '2024-07-01',
    validTo: null,
    sourceNote: 'synthetic test fixture (#1135)',
    synthetic: true,
  });
  return {
    statute,
    section: '106',
    heading,
    cleanup: async () => {
      await owner
        .delete(statuteSectionVersion)
        .where(eq(statuteSectionVersion.sectionId, section.id));
      await owner.delete(statuteSection).where(eq(statuteSection.id, section.id));
      await owner.delete(statuteAct).where(eq(statuteAct.id, act.id));
    },
  };
}
