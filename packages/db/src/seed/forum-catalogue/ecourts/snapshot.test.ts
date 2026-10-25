// The eCourts snapshot importer (#635): validator errors, the A0 mapping and per-state level flag,
// and the owner-role seed with imported rows (idempotent, workspace forums untouched).
import { ForumSeedSchema } from '@causedeck/validators/forum';
import { describe, expect, it } from 'vitest';

import { FORUM_CATALOGUE_VERSION } from '../index.ts';

import { ECOURTS_DISTRICT } from './index.ts';
import { snapshotToForumSeeds, validateSnapshot } from './snapshot.ts';

// Fictional establishments: not real courts, not portal data.
const FICTIONAL = {
  source: 'fictional test fixture',
  licence: 'none (test data)',
  retrievedOn: '2026-10-24',
  establishments: [
    { code: 'TST01', state: 'tn', district: 'Testpur', establishment: 'Fictional District Court' },
    { code: 'TST02', state: 'tn', district: 'Testpur', establishment: 'Fictional Family Court' },
    { code: 'TST03', state: 'ka', district: 'Imaginary Nagar', establishment: 'Sample Court' },
  ],
};

const [FIRST] = FICTIONAL.establishments as [
  (typeof FICTIONAL.establishments)[number],
  ...(typeof FICTIONAL.establishments)[number][],
];

const rejects = (raw: unknown) => {
  try {
    validateSnapshot(raw);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the snapshot to be rejected');
};

describe('validateSnapshot (#635)', () => {
  it('accepts a valid snapshot', () => {
    expect(validateSnapshot(FICTIONAL)).toBe(FICTIONAL);
  });

  it('rejects duplicate codes (case-insensitively, per state)', () => {
    const dup = {
      ...FICTIONAL,
      establishments: [...FICTIONAL.establishments, { ...FIRST, code: 'tst01' }],
    };
    expect(rejects(dup)).toMatch(/establishments\[3\]: duplicate code tst01 in state tn/);
  });

  it('rejects an unknown state', () => {
    const bad = {
      ...FICTIONAL,
      establishments: [{ ...FIRST, state: 'xx' }],
    };
    expect(rejects(bad)).toMatch(/unknown state "xx"/);
  });

  it('rejects an invalid code', () => {
    const bad = {
      ...FICTIONAL,
      establishments: [{ ...FIRST, code: 'a b' }],
    };
    expect(rejects(bad)).toMatch(/invalid code "a b"/);
  });

  it('rejects missing provenance, naming each missing field', () => {
    const message = rejects({ establishments: [] });
    expect(message).toMatch(/missing provenance: source/);
    expect(message).toMatch(/missing provenance: licence/);
    expect(message).toMatch(/missing provenance: retrievedOn/);
    expect(rejects({ ...FICTIONAL, licence: '  ' })).toMatch(/missing provenance: licence/);
  });
});

describe('snapshotToForumSeeds (#635)', () => {
  it('maps every establishment to a valid A0 district forum with a unique code', () => {
    const seeds = snapshotToForumSeeds(FICTIONAL);
    expect(seeds.map((s) => s.code)).toEqual([
      'in.tn.testpur.fictional-district-court-tst01',
      'in.tn.testpur.fictional-family-court-tst02',
      'in.ka.imaginary-nagar.sample-court-tst03',
    ]);
    for (const s of seeds) {
      expect(ForumSeedSchema.parse(s)).toEqual(s);
      expect(s).toMatchObject({ adapterLevel: 'A0', jurisdictionKind: 'district', enabled: true });
      expect(s.config.hosts).toEqual(['services.ecourts.gov.in']);
    }
    expect(snapshotToForumSeeds(FICTIONAL)).toEqual(seeds);
  });

  it('takes the adapter level from the per-state flag', () => {
    const seeds = snapshotToForumSeeds(FICTIONAL, { levels: { tn: 'A1' } });
    expect(seeds.map((s) => s.adapterLevel)).toEqual(['A1', 'A1', 'A0']);
  });

  it('skips codes already in the hand-written catalogue', () => {
    const skip = new Set(['in.ka.imaginary-nagar.sample-court-tst03']);
    expect(snapshotToForumSeeds(FICTIONAL, { skipCodes: skip })).toHaveLength(2);
  });

  it('ships an empty reviewed snapshot: the catalogue gains no rows until #640', () => {
    expect(ECOURTS_DISTRICT).toEqual([]);
    expect(FORUM_CATALOGUE_VERSION).toBe('2026-10-24.2');
  });
});
