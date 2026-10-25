// Capture reads exported chat files the lawyer chooses. It must never reach WhatsApp's Cloud API,
// a notification listener or the contact book (#525, CA-12, docs/product/09 §3).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

const FORBIDDEN =
  /whatsapp|baileys|twilio|messenger|graph[.-]?(?:api|facebook)|notification|contacts?\b|web-push|push-notifications/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('capture dependencies', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Record<
    string,
    Record<string, string> | undefined
  >;

  it('declare no WhatsApp Cloud API, notification or contact access package', () => {
    const names = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ].flatMap((field) => Object.keys(pkg[field] ?? {}));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => FORBIDDEN.test(n))).toEqual([]);
  });

  it('are imported nowhere in the source', () => {
    const offenders = sourceFiles(path.join(ROOT, 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)]
        .map((m) => m[1] ?? '')
        .filter((spec) => !spec.startsWith('.') && FORBIDDEN.test(spec))
        .map((spec) => `${path.relative(ROOT, file)}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the whatsapp parser free of Node-only imports so it runs in a Web Worker', () => {
    const files = sourceFiles(path.join(ROOT, 'src/whatsapp')).filter(
      (f) => !f.endsWith('validate-selection.ts'),
    );
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"](?:node:|@causedeck\/)/);
    }
  });
});
