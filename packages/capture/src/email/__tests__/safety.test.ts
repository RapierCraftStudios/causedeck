// Prompt-injection posture, dropped mail and the no-mail-transport guard (#528), plus the MIME
// reader and HTML sanitiser.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseEmail } from '../mime.ts';
import { detectInjection, processIntake } from '../registry.ts';
import { htmlToText } from '../sanitize.ts';

import { CONTEXT, fixture, intake, parsed } from './helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('prompt-injection posture', () => {
  it('flags instruction-like text for Needs you and still treats it as data', async () => {
    const outcome = await parsed('injection');
    expect(outcome.result.diagnostics[0]).toMatchObject({
      code: 'instruction_like',
      severity: 'needs_you',
    });
    expect(outcome.result.drafts).toEqual([]);
  });

  it('does not flag ordinary legal text', () => {
    expect(detectInjection('Re-present the papers within 7 days. The prior order stands.')).toBe(
      false,
    );
  });
});

describe('dropped mail', () => {
  it('drops an out-of-office reply before the allow-list or any parser', async () => {
    expect(await intake('out-of-office')).toEqual({ status: 'dropped', reason: 'auto_reply' });
  });

  it('drops a bounce', async () => {
    const bounce = 'From: MAILER-DAEMON@example.test\nSubject: Undeliverable: hi\n\nfailed\n';
    const outcome = await processIntake(bounce, { allowList: [], context: CONTEXT });
    expect(outcome).toEqual({ status: 'dropped', reason: 'bounce' });
  });
});

describe('mime reader', () => {
  it('reads headers, auth verdicts and attachments', async () => {
    const email = await parseEmail(fixture('spoofed-sender'));
    expect(email.from.address).toBe('registry@example.test');
    expect(email.auth).toEqual({ spf: 'fail', dkim: 'none', dmarc: 'fail' });
    const pdf = await parseEmail(fixture('pdf-only'));
    expect(pdf.attachments.map((a) => [a.fileName, a.contentType])).toEqual([
      ['cause-list-23.10.2026.pdf', 'application/pdf'],
    ]);
  });

  it('parses an attached message/rfc822 as a forwarded message', async () => {
    const email = await parseEmail(fixture('forward-rfc822'));
    expect(email.forwarded).toHaveLength(1);
    expect(email.forwarded[0]?.from.address).toBe('aims-registry@example.test');
    expect(email.attachments).toEqual([]);
  });
});

describe('htmlToText', () => {
  it('drops scripts, tracking pixels and remote content without fetching anything', () => {
    const text = htmlToText(
      '<html><head><style>p{}</style></head><body><p>Hearing &amp; orders</p>' +
        '<img src="https://track.example.test/p.gif" width="1" height="1">' +
        '<script>fetch("https://evil.example.test")</script><div>Next&nbsp;date 5&#46;11</div></body></html>',
    );
    expect(text).toBe('Hearing & orders\nNext date 5.11');
    expect(text).not.toMatch(/track|evil|fetch/);
  });
});

describe('no mail transport', () => {
  const TRANSPORT =
    /(?:nodemailer|smtp|sendmail|@aws-sdk\/client-ses|mailgun|postmark|sendgrid|resend|node:net|node:tls)/i;

  it('imports no mail transport in the email sources or the package manifest', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== '__tests__') walk(full);
        } else if (full.endsWith('.ts')) files.push(full);
      }
    };
    walk(join(HERE, '..'));
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      const imports = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /^\s*(?:import|export)\b.*\bfrom\b|^\s*import\(/.test(line));
      expect(imports.join('\n'), file).not.toMatch(TRANSPORT);
    }
    const manifest = JSON.parse(readFileSync(join(HERE, '../../../package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies).join(' ')).not.toMatch(TRANSPORT);
  });
});
