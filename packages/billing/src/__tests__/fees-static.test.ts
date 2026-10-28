import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../fees', import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

const FORBIDDEN = [
  /razorpay/i,
  /\.\.\/provider/,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /node:(https?|net|tls|dgram)/,
  /from ['"](axios|got|undici|nodemailer|stripe)['"]/,
  /@react-pdf/,
  /\b(payout|transfer|disburse)\b/i,
];

describe('fee modules move no money', () => {
  it('finds the fee modules', () => {
    expect(files).toEqual(
      expect.arrayContaining(['gst.ts', 'invoice.ts', 'ledger.ts', 'render.ts']),
    );
  });
  for (const file of files) {
    it(`${file} has no transport, payment SDK or transfer`, () => {
      const source = readFileSync(join(DIR, file), 'utf8');
      for (const pattern of FORBIDDEN) expect(source).not.toMatch(pattern);
    });
  }
});
