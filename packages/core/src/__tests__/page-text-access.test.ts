// Static check (#892, ADR 0051 §Anonymised text): modules that serve research, search and the public
// API never read the raw `judgment.page_text`; they read `redacted_text`. Citation verification
// (ADR 0051:103) and the masking and redaction internals are the only readers. No database.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..');
const SERVED = ['research', 'search', 'public-api'];
const RAW_READ = /\bjudgment\.pageText\b|\bpage_text\b|\bpageText\s*:\s*judgment\b/;

const filesUnder = (dir: string): string[] => {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('__tests__'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
};

describe('raw judgment text access', () => {
  it('is never selected by research, search or public-api modules', () => {
    const offenders = SERVED.flatMap((d) => filesUnder(path.join(SRC, d))).filter((f) =>
      RAW_READ.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('is read in core only by citation verification and the masking and redact internals', () => {
    const allowed = new Set([
      'citations/verify.ts',
      'corpus/masking.ts',
      'jobs/definitions/corpus-redact.ts',
    ]);
    const offenders = filesUnder(SRC)
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
      .filter((f) => !allowed.has(f))
      .filter((f) => /\bjudgment\.pageText\b/.test(readFileSync(path.join(SRC, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('scans research (the alert scan reads redacted_text)', () => {
    expect(filesUnder(path.join(SRC, 'research')).length).toBeGreaterThan(0);
  });
});
