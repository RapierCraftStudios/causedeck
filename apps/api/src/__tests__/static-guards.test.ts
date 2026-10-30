// Source guards: route handlers call `@causedeck/core` services (no SQL or Drizzle in routes), and
// no exported type in the API uses `any`.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const SQL_IN_ROUTES = [
  /from ['"]drizzle-orm/,
  /from ['"]postgres['"]/,
  /\bsql`/,
  /\.select\(/,
  /\.insert\(/,
  /\.update\(/,
  /\.delete\(/,
  /\.execute\(/,
  /\bschema\./,
];

const ANY = /(:\s*any\b|<any\b|\bany\[\]|as any\b|,\s*any\s*>)/;

describe('static guards', () => {
  const routes = sourceFiles(path.join(SRC, 'routes'));

  it('finds the route files', () => {
    expect(routes.map((f) => path.relative(SRC, f)).sort()).toEqual(
      expect.arrayContaining([
        'routes/v1/index.ts',
        'routes/v1/me.ts',
        'routes/v1/workspaces.ts',
        'routes/v1/billing.ts',
        'routes/v1/webhook-endpoints.ts',
        'routes/webhooks/razorpay.ts',
        'routes/inbound-email.ts',
        'routes/inbound-whatsapp.ts',
        'routes/csp-report.ts',
      ]),
    );
  });

  it.each(routes.map((f) => [path.relative(SRC, f), f]))(
    '%s has no SQL or Drizzle',
    (_name, file) => {
      const text = readFileSync(file, 'utf8');
      for (const pattern of SQL_IN_ROUTES) expect(text, String(pattern)).not.toMatch(pattern);
      // The CSP report route (#104) reads no data: it logs and counts, so it imports no core domain.
      if (_name === 'routes/csp-report.ts') return;
      expect(text).toMatch(
        /from '@causedeck\/core\/(workspaces|billing|email-intake|whatsapp-link|court-day|webhooks)'|from '\.\/(me|workspaces)\.ts'/,
      );
    },
  );

  it.each(sourceFiles(SRC).map((f) => [path.relative(SRC, f), f]))(
    '%s has no `any`',
    (_name, file) => {
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
      expect(code).not.toMatch(ANY);
    },
  );
});
