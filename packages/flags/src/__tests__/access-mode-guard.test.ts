// Guardrail (#22, ADR 0011): access-mode names are a closed enum with no member that implies
// automated server-side retrieval from court sites without authorisation, scraping or captcha
// circumvention. The type, the database enum and every migration that touches it must match the
// frozen list below, and every mode must be named in an ADR: adding one fails here until an ADR
// (superseding 0011) documents it and this list is updated in the same change.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ACCESS_MODE_NAMES, accessMode } from '@causedeck/db/schema';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { ACCESS_MODES, type AccessMode } from '../access-mode.ts';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const FROZEN = ['user_supplied', 'device_user_triggered', 'official', 'licensed', 'none'];
const FORBIDDEN = /scrap|crawl|captcha|bypass|headless|spider|harvest|auto_?fetch|server_?retriev/i;

function migrationModes(): string[] {
  const dir = path.join(ROOT, 'packages/db/migrations');
  const modes: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const m of text.matchAll(/CREATE TYPE "public"\."access_mode" AS ENUM\(([^)]*)\)/g)) {
      modes.push(...[...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((v) => v[1] ?? ''));
    }
    for (const m of text.matchAll(
      /ALTER TYPE "(?:public"\.")?access_mode" ADD VALUE (?:IF NOT EXISTS )?'([^']+)'/g,
    )) {
      modes.push(m[1] ?? '');
    }
  }
  return modes;
}

function adrText(): string {
  const dir = path.join(ROOT, 'docs/adr');
  return readdirSync(dir)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}

describe('access-mode names are a closed, ADR-backed enum', () => {
  it('the type is exactly the frozen union', () => {
    expectTypeOf<AccessMode>().toEqualTypeOf<
      'user_supplied' | 'device_user_triggered' | 'official' | 'licensed' | 'none'
    >();
    expectTypeOf(ACCESS_MODES).toEqualTypeOf<
      readonly ['user_supplied', 'device_user_triggered', 'official', 'licensed', 'none']
    >();
  });

  it('the code, the schema enum and the migrations all match the frozen list', () => {
    expect([...ACCESS_MODES]).toEqual(FROZEN);
    expect([...ACCESS_MODE_NAMES]).toEqual(FROZEN);
    expect([...accessMode.enumValues]).toEqual(FROZEN);
    expect(migrationModes()).toEqual(FROZEN);
  });

  it('no mode name implies scraping, crawling or captcha circumvention', () => {
    for (const mode of new Set([...ACCESS_MODES, ...migrationModes()])) {
      expect(mode, mode).not.toMatch(FORBIDDEN);
    }
  });

  it('every mode is documented in an ADR', () => {
    const adrs = adrText();
    for (const mode of new Set([...ACCESS_MODES, ...migrationModes()])) {
      expect(adrs, `mode ${mode} needs an ADR`).toContain(`\`${mode}\``);
    }
  });
});
