// The redaction detector test (#516): saved fixtures contain no real party names or personal data.
// Known names and PII are planted in contributed documents; the built fixture must hold none of
// them, keep its structure and anchors, and the detector must catch a name that is put back.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEchoAdapter } from '../example/echo-adapter.ts';
import { AccuracyBaselineSchema } from '../testing/accuracy.ts';
import { FIXTURES_ROOT, FixtureManifestSchema, GOLDEN_RECEIVED_AT } from '../testing/golden.ts';
import {
  buildFixture,
  createRedactor,
  findLeaks,
  findPii,
  partyNames,
  WORKBENCH_RECEIVED_AT,
} from '../workbench/index.ts';

const DOCUMENT = readFileSync(path.join(FIXTURES_ROOT, 'echo/list-01-admission.input.txt'), 'utf8');
const NAMES = ['Arun Kavitham'];

describe('partyNames', () => {
  it('keeps people and drops institutions', () => {
    expect(partyNames('Arun Kavitham vs Fictional District Collector')).toEqual(['Arun Kavitham']);
    expect(partyNames('M/s. Rao and Sons vs State of Karnataka, Mr. Ravi')).toEqual([
      'Rao',
      'Sons',
      'Ravi',
    ]);
    expect(partyNames(undefined)).toEqual([]);
  });
});

describe('detector', () => {
  it('finds names whatever the case or spacing, and personal data by shape', () => {
    expect(findLeaks('ARUN   kavitham appeared', NAMES)).toEqual([
      { kind: 'name', value: 'ARUN   kavitham' },
    ]);
    expect(findLeaks('Arunkavitham', NAMES)).toEqual([]);
    const kinds = findPii(
      'ph +91 9876543210? mail a.b@firm.in aadhaar 2345 6789 0123 pan ABCDE1234F',
    ).map((leak) => leak.kind);
    expect(kinds).toEqual(['email', 'phone', 'aadhaar', 'pan']);
  });

  it('skips the redaction placeholders', () => {
    const redactor = createRedactor([], '');
    const out = redactor.text('9876543210 a@b.in 2345 6789 0123 ABCDE1234F');
    expect(findPii(out)).toEqual([]);
    expect(redactor.counts().pii).toBe(4);
  });
});

describe('buildFixture', () => {
  it('replaces party names with synthetic ones and keeps the structure', async () => {
    const withPii = `${DOCUMENT}\nContact: arun@chambers.in, 9876543210\n`;
    const { bundle, redactions } = await buildFixture({
      adapter: createEchoAdapter(),
      name: 'list-99-redacted',
      format: 'text',
      content: withPii,
    });
    const saved = `${bundle.inputContent}\n${JSON.stringify(bundle.expected)}`;
    expect(findLeaks(saved, NAMES)).toEqual([]);
    expect(saved).not.toMatch(/Arun Kavitham|arun@chambers\.in|9876543210/i);
    expect(redactions.names).toBeGreaterThan(0);
    expect(redactions.pii).toBeGreaterThanOrEqual(2);
    // Structure: same number of lines, same rows, anchors still quote the redacted input.
    expect(bundle.inputContent.split('\n')).toHaveLength(withPii.split('\n').length);
    expect(bundle.expected.rows.length).toBeGreaterThan(0);
    for (const row of bundle.expected.rows) {
      expect(bundle.inputContent.split('\f')[row.anchor.page - 1]).toContain(row.anchor.quote);
    }
    expect(bundle.manifestEntry).toMatchObject({
      origin: 'lawyer-supplied',
      classification: 'REDACTED',
    });
  });

  it('replaces the same name the same way every time', async () => {
    const run = () =>
      buildFixture({ adapter: createEchoAdapter(), name: 'a', format: 'text', content: DOCUMENT });
    expect((await run()).bundle).toEqual((await run()).bundle);
  });

  it('redacts a name added by the labeler', async () => {
    const { bundle } = await buildFixture({
      adapter: createEchoAdapter(),
      name: 'extra',
      format: 'text',
      content: DOCUMENT,
      extraNames: ['Fictional District Collector'],
    });
    expect(bundle.inputContent).not.toContain('Fictional District Collector');
  });

  it('uses the golden receivedAt', () => {
    expect(WORKBENCH_RECEIVED_AT).toBe(GOLDEN_RECEIVED_AT);
  });
});

describe('committed fixtures', () => {
  it('hold no personal data where a lawyer or the workbench supplied them', () => {
    const offenders: string[] = [];
    // The committed sources are the ones in the accuracy baseline; other directories under the
    // root (such as git-ignored `generated/` output) are not committed fixtures.
    const baseline = AccuracyBaselineSchema.parse(
      JSON.parse(readFileSync(path.join(FIXTURES_ROOT, 'accuracy-baseline.json'), 'utf8')),
    );
    for (const source of Object.keys(baseline)) {
      const entry = { name: source };
      const dir = path.join(FIXTURES_ROOT, entry.name);
      const manifest = FixtureManifestSchema.parse(
        JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
      );
      for (const fixture of manifest.fixtures.filter((f) => f.origin === 'lawyer-supplied')) {
        const name = fixture.file.replace(/\.input\.[^.]+$/, '');
        for (const file of [fixture.file, `${name}.expected.json`]) {
          if (findPii(readFileSync(path.join(dir, file), 'utf8')).length > 0) {
            offenders.push(`${entry.name}/${file}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
