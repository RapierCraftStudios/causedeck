// Structure checks for infra/runbooks (#103): required headings, an owner and a `Last drilled`
// field, working internal links, the guardrail statements, and no secrets or personal data.
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test runs describe/it itself */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Runbooks that must carry the full structure. workspace-deletion and data-ops predate #103. */
const RUNBOOKS = [
  'README.md',
  'cert-in-6h.md',
  'dpdp-breach.md',
  'key-rotation.md',
  'restore.md',
  'dr-hyderabad.md',
  'on-call.md',
  'court-day-freeze.md',
];
const REQUIRED_HEADINGS = [
  'Purpose',
  'Triggers',
  'Roles',
  'Steps',
  'Communications',
  'Evidence',
  'Verification',
  'After action',
];
const TEMPLATES = [
  'templates/incident-report.md',
  'templates/customer-notice.md',
  'templates/post-incident-review.md',
  'templates/evidence-checklist.md',
  'drills/TEMPLATE.md',
];

const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'test') return [];
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? markdownFiles(full) : name.endsWith('.md') ? [full] : [];
  });
}

describe('runbook structure', () => {
  for (const file of RUNBOOKS) {
    it(`${file} has the required headings, an owner and a Last drilled date`, () => {
      const text = read(file);
      const headings = new Set(
        [...text.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map((m) => m[1]?.toLowerCase()),
      );
      for (const heading of REQUIRED_HEADINGS) {
        assert.ok(headings.has(heading.toLowerCase()), `${file} lacks the "${heading}" heading`);
      }
      assert.match(text, /^Owner:\s*\S+/m, `${file} lacks an Owner`);
      assert.match(
        text,
        /^Last drilled:\s*(\d{4}-\d{2}-\d{2}|not yet drilled)\b/m,
        `${file} lacks a valid Last drilled (a date, or "not yet drilled" before launch)`,
      );
    });
  }

  it('ships every template', () => {
    for (const file of TEMPLATES)
      assert.ok(existsSync(path.join(root, file)), `${file} is missing`);
  });

  it('keeps the tools the runbooks name', () => {
    for (const tool of ['evidence-export.sh', 'rotate-kek.sh']) {
      assert.ok(
        existsSync(path.join(root, '..', 'scripts', 'runbooks', tool)),
        `${tool} is missing`,
      );
    }
  });
});

describe('internal links', () => {
  for (const file of markdownFiles(root)) {
    const rel = path.relative(root, file);
    it(`${rel} links resolve`, () => {
      const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = (match[1] ?? '').split('#')[0] ?? '';
        if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        assert.ok(
          existsSync(path.resolve(path.dirname(file), target)),
          `${rel}: broken link ${target}`,
        );
      }
    });
  }
});

describe('guardrails', () => {
  for (const file of ['README.md', 'cert-in-6h.md', 'dpdp-breach.md', 'on-call.md']) {
    it(`${file} states no automated outbound messages and human approval`, () => {
      const text = read(file).replace(/\s+/g, ' ');
      assert.match(text, /No automated outbound messages/i);
      assert.match(text, /(approved by a human|approved by a human and sent|human approv)/i);
      assert.match(text, /sent by a human/i);
    });
  }

  for (const file of ['cert-in-6h.md', 'dpdp-breach.md', 'templates/customer-notice.md']) {
    it(`${file} marks counsel-owned wording`, () => {
      assert.match(read(file), /Counsel to confirm/);
    });
  }

  it('the CERT-In runbook defines the 6-hour clock and the 180-day store', () => {
    const text = read('cert-in-6h.md');
    assert.match(text, /6-hour clock starts at detection/);
    assert.match(text, /180 days/);
  });
});

describe('secrets and personal data', () => {
  const patterns: [string, RegExp][] = [
    ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['token', /\b(ghp|gho|github_pat|xox[abprs]|sk_live|glpat)[-_][A-Za-z0-9_-]{16,}/],
    [
      'assigned secret',
      /\b(?:[A-Z_]*(?:SECRET|PASSWORD|TOKEN|KEY)[A-Z_]*)=['"]?[A-Za-z0-9+/=_-]{24,}/,
    ],
    ['base64 key', /\b[A-Za-z0-9+/]{43}=(?![A-Za-z0-9])/],
    ['Indian mobile number', /(?<![\d])(?:\+91[\s-]?)?[6-9]\d{9}(?![\d])/],
    ['Aadhaar-like number', /(?<![\d])\d{4}\s\d{4}\s\d{4}(?![\d])/],
    ['PAN', /\b[A-Z]{5}\d{4}[A-Z]\b/],
    ['real e-mail address', /\b[\w.+-]+@(?!example\.(?:com|org))[\w-]+\.[a-z]{2,}\b/i],
  ];
  for (const file of markdownFiles(root)) {
    const rel = path.relative(root, file);
    it(`${rel} has no secrets or personal data`, () => {
      const text = readFileSync(file, 'utf8');
      for (const [name, pattern] of patterns) {
        assert.ok(!pattern.test(text), `${rel} looks like it contains a ${name}`);
      }
    });
  }
});
