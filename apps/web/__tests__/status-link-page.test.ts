// The public status link page (#88) accepts GET only and offers nothing to submit: no route handler,
// no server action, no form, no input, no client script, no third-party request.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'app',
  '(public)',
  's',
  '[token]',
);
const files = readdirSync(DIR);
const text = (f: string) => readFileSync(path.join(DIR, f), 'utf8');

describe('/s/[token] is read-only', () => {
  it('has no route handler, so POST, PUT, PATCH and DELETE answer 405', () => {
    expect(files).not.toContain('route.ts');
    expect(files).toEqual(
      expect.arrayContaining(['page.tsx', 'loading.tsx', 'not-found.tsx', 'error.tsx']),
    );
  });

  it.each(files)('%s has no action, form, input or external request', (f) => {
    const src = text(f);
    expect(src).not.toMatch(/['"]use server['"]/);
    expect(src).not.toMatch(/<(form|input|textarea|button|script|a)\b/);
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).not.toMatch(/\bfetch\(/);
  });

  it('is never cached, never indexed and sends no referrer', () => {
    const src = text('page.tsx');
    expect(src).toMatch(/dynamic = 'force-dynamic'/);
    expect(src).toMatch(/index: false/);
    expect(src).toMatch(/referrer: 'no-referrer'/);
  });

  it('404s on a missing link so a flag-off deployment answers every token the same', () => {
    expect(text('page.tsx')).toMatch(/not_found'\) notFound\(\)/);
  });
});
