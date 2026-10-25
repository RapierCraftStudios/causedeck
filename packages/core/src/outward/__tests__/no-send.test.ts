// ADR 0039: the outward domain has no transport, job or endpoint.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DIR = path.join(fileURLToPath(new URL('..', import.meta.url)));
const files = readdirSync(DIR, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
  .map((f) => path.join(DIR, f));

const FORBIDDEN = [
  /from\s+['"][^'"]*(notifications|whatsapp|mailer|nodemailer|resend|queue|worker|jobs)[^'"]*['"]/iu,
  /\bfetch\s*\(/u,
  /\bsendMail\b|\bsendEmail\b|\bsendMessage\b|\bsendWhatsapp\b/iu,
  /\bregisterJob\b|\bdefineJob\b|\bschedule\s*\(/u,
];

describe('outward has no send path', () => {
  it('scans some source files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports no transport, queue or job code and makes no network call', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(source), `${path.basename(file)} ${String(pattern)}`).toBe(false);
      }
    }
  });

  it('exports no send function', () => {
    const index = readFileSync(path.join(DIR, 'index.ts'), 'utf8');
    expect(/\bsend\w*\b/iu.test(index.replace(/\/\/.*$/gmu, ''))).toBe(false);
  });
});
