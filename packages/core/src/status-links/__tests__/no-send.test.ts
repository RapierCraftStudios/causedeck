// The status links domain sends nothing (ADR 0049): a static check of its sources.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

const FORBIDDEN = [
  /from\s+'[^']*\/(email|email-intake|whatsapp|whatsapp-link|notifications?|webhooks|calendar|voice)\/index\.ts'/,
  /from\s+'@causedeck\/(email|whatsapp|notifications?|calendar|fetch)/,
  /from\s+'(nodemailer|resend|twilio)/,
  /from\s+'node:(http|https|net)'/,
  /\b(sendEmail|sendWhatsApp|sendNotification|sendSms|enqueueNotification)\b/i,
  /\bfetch\(/,
];

describe('status links send nothing (ADR 0049)', () => {
  it('reads the domain sources', () => {
    expect(sources).toEqual(expect.arrayContaining(['create.ts', 'resolve.ts', 'index.ts']));
  });

  it.each(sources)('%s has no transport import or call', (file) => {
    const text = readFileSync(path.join(DIR, file), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    for (const pattern of FORBIDDEN) expect(text, String(pattern)).not.toMatch(pattern);
  });
});
