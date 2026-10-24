// Synthetic bundles for the plan engine tests (#548): fictional advocates, names and numbers, no
// real party or court data. Each bundle is the staged drafts of one drop, the identifiers of the
// advocate who dropped it, and the plan summary the engine must produce (golden). Rows of other
// advocates carry `SECRET` markers the tests look for in every output.
import { parseAdvocate, parseKarnatakaAdvocate } from '@causedeck/adapters';

import { getAdvocateIdentifiers } from '../identifiers.ts';
import type { PlanDraftInput } from '../bootstrap.ts';

export const SECRET = 'SECRET-OTHER-ADVOCATE';

let counter = 0;
export function draft(
  payload: Record<string, unknown>,
  options: { kind?: string; confidence?: number; captureId?: string | null; input?: string } = {},
): PlanDraftInput {
  counter += 1;
  return {
    proposalId: `p-${String(counter).padStart(5, '0')}`,
    captureId: options.captureId ?? 'c-1',
    kind: options.kind ?? 'new_proceeding',
    input: options.input ?? 'list',
    payload,
    anchorIds: [`a-${String(counter).padStart(5, '0')}`],
    confidence: options.confidence ?? 0.9,
    proceedingId: null,
  };
}

export interface MatterSummary {
  keys: string[];
  reason: string;
  confidence: number;
  next: string | null;
  issues: string[];
}

export interface Bundle {
  today: string;
  identifiers: ReturnType<typeof getAdvocateIdentifiers>;
  drafts: PlanDraftInput[];
  expected: {
    matters: MatterSummary[];
    history: { proceedingKey: string; date: string }[];
    counts: { matchedRows: number; unmatchedRowsCount: number };
  };
}

/** A Chennai solo advocate: W.P. with W.M.P. children, an O.S. -> A.S. -> S.A. chain, a conflict. */
export function chennaiSolo(): Bundle {
  const me = [parseAdvocate('Mr. R. Fictional MS/123/1900')];
  const other = [parseAdvocate(`Mr. Z. Stranger ${SECRET}`)];
  const row = (key: string, extra: Record<string, unknown>, advocates = me) =>
    draft({
      matchKey: key,
      forumCode: 'madras-hc',
      advocates,
      ...extra,
    });
  const num = (type: string, no: string, year: number) => ({
    caseTypeRaw: type,
    caseNumber: no,
    caseYear: year,
  });
  return {
    today: '2026-11-10',
    identifiers: getAdvocateIdentifiers({
      enrolmentNumbers: ['ms / 123 / 1900'],
      aliases: ['R. Fictional, Adv.'],
    }),
    drafts: [
      row('WP/1234/2024', {
        ...num('W.P.', '1234', 2024),
        parties: 'A V B',
        listDate: '2026-11-12',
      }),
      row('WMP/2001/2024', {
        ...num('W.M.P.', '2001', 2024),
        parentProceedingKey: 'WP/1234/2024',
        listDate: '2026-11-12',
      }),
      row('WMP/2002/2024', {
        ...num('W.M.P.', '2002', 2024),
        parentProceedingKey: 'WP/1234/2024',
        listDate: '2026-11-05',
      }),
      row('OS/10/2020', {
        ...num('O.S.', '10', 2020),
        cnr: 'TNCH010000012020',
        listDate: '2026-11-15',
      }),
      row('AS/20/2023', {
        ...num('A.S.', '20', 2023),
        lowerCourtRef: 'TNCH010000012020',
        listDate: '2026-11-20',
      }),
      row('SA/5/2025', { ...num('S.A.', '5', 2025), lowerCourtRef: 'AS/20/2023' }),
      row('CP/9/2024', { ...num('C.P.', '9', 2024), listDate: '2026-11-18' }),
      row('CP/9/2024', { ...num('C.P.', '9', 2024), listDate: '2026-11-19' }),
      row(`${SECRET}/1/2024`, { ...num('W.P.', '1', 2024), listDate: '2026-11-12' }, other),
      row(`${SECRET}/2/2024`, { ...num('W.P.', '2', 2024), listDate: '2026-11-13' }, other),
      row(`${SECRET}/3/2024`, { ...num('W.P.', '3', 2024), listDate: '2026-11-14' }, other),
    ],
    expected: {
      matters: [
        {
          keys: ['AS/20/2023', 'OS/10/2020', 'SA/5/2025'],
          reason: 'appeal linked by CNR; appeal linked by lower-court case number',
          confidence: 0.8,
          next: '2026-11-15',
          issues: [],
        },
        {
          keys: ['CP/9/2024'],
          reason: 'single proceeding',
          confidence: 0.9,
          next: null,
          issues: ['conflicting_dates'],
        },
        {
          keys: ['WMP/2001/2024', 'WMP/2002/2024', 'WP/1234/2024'],
          reason: 'main petition with its child proceedings',
          confidence: 0.9,
          next: '2026-11-12',
          issues: [],
        },
      ],
      history: [{ proceedingKey: 'WMP/2002/2024', date: '2026-11-05' }],
      counts: { matchedRows: 8, unmatchedRowsCount: 3 },
    },
  };
}

/** A Bengaluru chamber: two advocates, connected batch, same-party matters, a past-only case. */
export function bengaluruChamber(): Bundle {
  const senior = [parseKarnatakaAdvocate('Sri. A.B. Fictional KAR/1234/2010')];
  const junior = [parseKarnatakaAdvocate('Smt. S. Partner')];
  const other = [parseKarnatakaAdvocate(`Sri. Q. Rival ${SECRET}`)];
  const row = (key: string, advocates: typeof senior, extra: Record<string, unknown>) =>
    draft({ matchKey: key, forumCode: 'karnataka-hc', advocates, ...extra });
  return {
    today: '2026-11-10',
    identifiers: getAdvocateIdentifiers({
      enrolmentNumbers: ['kar / 1234 / 2010'],
      aliases: ['Sri A.B. Fictional', 'Smt. S. Partner'],
    }),
    drafts: [
      row('WP/100/2025', senior, {
        caseTypeRaw: 'W.P.',
        caseNumber: '100',
        caseYear: 2025,
        connectedKeys: ['WP/101/2025'],
        listDate: '2026-11-11',
      }),
      row('WP/101/2025', junior, {
        caseTypeRaw: 'W.P.',
        caseNumber: '101',
        caseYear: 2025,
        listDate: '2026-11-11',
      }),
      row('CRP/5/2025', senior, {
        caseTypeRaw: 'C.R.P.',
        caseNumber: '5',
        caseYear: 2025,
        parties: 'X Bank V Y Traders',
        listDate: '2026-11-20',
      }),
      row('MFA/6/2025', junior, {
        caseTypeRaw: 'M.F.A.',
        caseNumber: '6',
        caseYear: 2025,
        parties: 'X  Bank v Y Traders',
        listDate: '2026-11-20',
      }),
      row('RFA/7/2025', senior, {
        caseTypeRaw: 'R.F.A.',
        caseNumber: '7',
        caseYear: 2025,
        listDate: '2026-10-01',
      }),
      row(`${SECRET}/8/2025`, other, { caseTypeRaw: 'W.P.', caseNumber: '8', caseYear: 2025 }),
      row(`${SECRET}/9/2025`, other, { caseTypeRaw: 'W.P.', caseNumber: '9', caseYear: 2025 }),
    ],
    expected: {
      matters: [
        {
          keys: ['CRP/5/2025', 'MFA/6/2025'],
          reason: 'same parties',
          confidence: 0.6,
          next: '2026-11-20',
          issues: [],
        },
        {
          keys: ['RFA/7/2025'],
          reason: 'single proceeding',
          confidence: 0.9,
          next: null,
          issues: [],
        },
        {
          keys: ['WP/100/2025', 'WP/101/2025'],
          reason: 'connected matters heard together',
          confidence: 0.9,
          next: '2026-11-11',
          issues: [],
        },
      ],
      history: [{ proceedingKey: 'RFA/7/2025', date: '2026-10-01' }],
      counts: { matchedRows: 5, unmatchedRowsCount: 2 },
    },
  };
}
