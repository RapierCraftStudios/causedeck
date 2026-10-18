// Creates the next ADR from the template and adds it to the index:
// `pnpm adr:new "Title" [--dir <dir>] [--date YYYY-MM-DD]`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function nextNumber(dir) {
  const numbers = readdirSync(dir)
    .map((name) => name.match(/^(\d{4})-.+\.md$/)?.[1])
    .filter(Boolean)
    .map(Number);
  return String(Math.max(0, ...numbers) + 1).padStart(4, '0');
}

/** Inserts `row` after the last row of the index table (the first table with ADR links). */
export function appendIndexRow(readme, row) {
  const lines = readme.split('\n');
  const last = lines.findLastIndex((line) => /^\|\s*\[\d{4}\]\(/.test(line));
  if (last === -1) throw new Error('README.md: index table not found');
  lines.splice(last + 1, 0, row);
  return lines.join('\n');
}

export function createAdr({ dir, title, date }) {
  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  const slug = slugify(cleanTitle);
  if (!slug) throw new Error('title must contain letters or digits');
  if (cleanTitle.includes('|')) throw new Error('title must not contain "|"');
  const number = nextNumber(dir);
  const file = `${number}-${slug}.md`;
  const target = path.join(dir, file);
  if (existsSync(target)) throw new Error(`${file} already exists`);

  const body = readFileSync(path.join(dir, '0000-template.md'), 'utf8')
    .replaceAll('{{NUMBER}}', number)
    .replaceAll('{{TITLE}}', cleanTitle)
    .replaceAll('{{DATE}}', date);
  writeFileSync(target, body, { flag: 'wx' });

  const readmePath = path.join(dir, 'README.md');
  const row = `| [${number}](${file}) | ${cleanTitle} | Proposed | ${date} | — |`;
  writeFileSync(readmePath, appendIndexRow(readFileSync(readmePath, 'utf8'), row));
  return target;
}

function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    if (at === -1) return undefined;
    const [, value] = args.splice(at, 2);
    return value;
  };
  const dir = path.resolve(
    option('--dir') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const date = option('--date') ?? today();
  const title = args.join(' ');
  if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('usage: pnpm adr:new "Title" [--dir <dir>] [--date YYYY-MM-DD]');
    process.exit(2);
  }
  try {
    console.log(path.relative(process.cwd(), createAdr({ dir, title, date })));
  } catch (error) {
    console.error(`adr:new: ${error.message}`);
    process.exit(1);
  }
}
