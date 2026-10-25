#!/usr/bin/env node
// Expand-only migration gate for deploys (#100). Code must be roll-back-able without a database
// rollback, so a deploy only applies migrations that expand the schema. A migration that drops a
// column, drops a table or sets NOT NULL on an existing column is rejected unless its file carries
// a `-- contract` tag (the contract release, after the expand release has been live).
//
//   node infra/scripts/check-migrations.mjs [--dir packages/db/migrations] [--applied release.json]
//
// --applied skips the migrations already listed in a previous release.json ("migrations": [...]).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES = [
  { re: /\bDROP\s+COLUMN\b/i, what: 'DROP COLUMN' },
  { re: /\bDROP\s+TABLE\b/i, what: 'DROP TABLE' },
  { re: /\bALTER\s+(?:COLUMN\s+)?"?[\w.]+"?\s+SET\s+NOT\s+NULL\b/i, what: 'ALTER ... SET NOT NULL' },
  { re: /\bALTER\s+TABLE\b[^;]*\bSET\s+NOT\s+NULL\b/i, what: 'ALTER ... SET NOT NULL' },
];
const CONTRACT_TAG = /^\s*--\s*contract\b/im;

/** SQL with comments and quoted literals blanked so keywords inside them never match. */
function stripSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** @returns {string[]} one message per violation; empty when the migration is expand-compatible. */
export function checkMigration(name, sql) {
  if (CONTRACT_TAG.test(sql)) return [];
  const body = stripSql(sql);
  const found = new Set();
  for (const { re, what } of RULES) if (re.test(body)) found.add(what);
  return [...found].map(
    (what) => `${name}: ${what} is not expand-compatible; ship an expand release first, then tag this file "-- contract"`,
  );
}

export function checkDirectory(dir, applied = []) {
  const skip = new Set(applied);
  const violations = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (skip.has(file)) continue;
    violations.push(...checkMigration(file, readFileSync(path.join(dir, file), 'utf8')));
  }
  return violations;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const option = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dir = path.resolve(option('--dir') ?? path.join(root, 'packages/db/migrations'));
  const appliedFile = option('--applied');
  let applied = [];
  if (appliedFile && existsSync(appliedFile)) {
    applied = JSON.parse(readFileSync(appliedFile, 'utf8')).migrations ?? [];
  }
  const violations = checkDirectory(dir, applied);
  for (const v of violations) console.error(`check-migrations: ${v}`);
  if (violations.length > 0) process.exit(1);
  console.log('check-migrations: ok');
}
