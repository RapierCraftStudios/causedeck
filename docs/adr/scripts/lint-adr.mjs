// Validates the ADR log in docs/adr: `node docs/adr/scripts/lint-adr.mjs [dir]` (`pnpm adr:lint`).
// Checks numbering contiguity, file names, required headings, status, date and index completeness.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATUSES = ['proposed', 'accepted', 'superseded', 'deprecated'];
export const REQUIRED_HEADINGS = [
  'Status',
  'Date',
  'Context',
  'Considered options',
  'Decision',
  'Consequences',
  'Revisit when',
];

const ADR_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** First non-empty line of the `## <name>` section, or undefined. */
function sectionValue(lines, name) {
  const start = lines.findIndex((line) => line.trim() === `## ${name}`);
  if (start === -1) return undefined;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) return undefined;
    if (line.trim()) return line.trim().replace(/^\*\*(.*)\*\*$/, '$1');
  }
  return undefined;
}

/** Parses an ADR's H1 (`# NNNN. Title`), level-2 headings, status and date. */
export function parseAdr(text) {
  const lines = text.split(/\r?\n/);
  const h1 = lines.find((line) => line.startsWith('# '));
  const match = h1?.match(/^# (\d{4})\. (\S.*)$/);
  return {
    number: match?.[1],
    title: match?.[2].trim(),
    headings: new Set(
      lines.filter((line) => line.startsWith('## ')).map((line) => line.slice(3).trim()),
    ),
    status: sectionValue(lines, 'Status'),
    date: sectionValue(lines, 'Date'),
  };
}

/** Parses the README index rows: `| [NNNN](file.md) | Title | Status | Date | Supersedes |`. */
export function parseIndex(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    const link = cells[0]?.trim().match(/^\[(\d{4})\]\(([^)]+)\)$/);
    if (!line.trim().startsWith('|') || !link) continue;
    rows.push({
      number: link[1],
      file: link[2],
      title: cells[1]?.trim(),
      status: cells[2]?.trim(),
      date: cells[3]?.trim(),
    });
  }
  return rows;
}

/** Returns a list of problems (empty when the ADR directory is valid). */
export function lintAdrDir(dir) {
  const problems = [];
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .filter((name) => name !== 'README.md')
    .sort();

  if (!files.includes('0000-template.md')) problems.push('0000-template.md: template is missing');

  const adrs = [];
  for (const file of files) {
    if (file === '0000-template.md') continue;
    const name = file.match(ADR_FILE);
    if (!name) {
      problems.push(`${file}: file name must be NNNN-kebab-case-title.md`);
      continue;
    }
    const adr = {
      file,
      fileNumber: name[1],
      ...parseAdr(readFileSync(path.join(dir, file), 'utf8')),
    };
    adrs.push(adr);
    if (!adr.number) problems.push(`${file}: first heading must be "# ${name[1]}. Title"`);
    else if (adr.number !== name[1])
      problems.push(`${file}: heading number ${adr.number} does not match file number ${name[1]}`);
    for (const heading of REQUIRED_HEADINGS) {
      if (!adr.headings.has(heading)) problems.push(`${file}: missing section "## ${heading}"`);
    }
    if (adr.headings.has('Status') && !STATUSES.includes(adr.status?.toLowerCase()))
      problems.push(`${file}: status "${adr.status ?? ''}" is not one of ${STATUSES.join('|')}`);
    if (adr.headings.has('Date') && !DATE.test(adr.date ?? ''))
      problems.push(`${file}: date "${adr.date ?? ''}" is not YYYY-MM-DD`);
  }

  // Numbering: 0001..N with no gaps and no duplicates.
  const seen = new Map();
  for (const adr of adrs) seen.set(adr.fileNumber, [...(seen.get(adr.fileNumber) ?? []), adr.file]);
  for (const [number, names] of seen) {
    if (names.length > 1)
      problems.push(`ADR ${number} is used by several files: ${names.join(', ')}`);
  }
  const numbers = [...seen.keys()].map(Number).sort((a, b) => a - b);
  const highest = numbers.at(-1) ?? 0;
  for (let n = 1; n <= highest; n += 1) {
    if (!seen.has(String(n).padStart(4, '0')))
      problems.push(
        `ADR ${String(n).padStart(4, '0')} is missing (numbers must be contiguous from 0001)`,
      );
  }

  // Index: one row per ADR, matching title and status.
  let index = [];
  try {
    index = parseIndex(readFileSync(path.join(dir, 'README.md'), 'utf8'));
  } catch {
    problems.push('README.md: index is missing');
  }
  const rows = new Map(index.map((row) => [row.number, row]));
  for (const adr of adrs) {
    const row = rows.get(adr.fileNumber);
    if (!row) {
      problems.push(`README.md: index has no row for ${adr.file}`);
      continue;
    }
    if (row.file !== adr.file)
      problems.push(`README.md: row ${row.number} links ${row.file}, expected ${adr.file}`);
    if (adr.title && row.title !== adr.title)
      problems.push(
        `README.md: row ${row.number} title "${row.title}" does not match "${adr.title}"`,
      );
    if (adr.status && row.status?.toLowerCase() !== adr.status.toLowerCase())
      problems.push(
        `README.md: row ${row.number} status "${row.status}" does not match "${adr.status}"`,
      );
    if (adr.date && row.date !== adr.date)
      problems.push(`README.md: row ${row.number} date "${row.date}" does not match "${adr.date}"`);
  }
  for (const row of index) {
    if (!seen.has(row.number)) problems.push(`README.md: row ${row.number} has no ADR file`);
  }
  return problems;
}

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(here, '..'));
  const problems = lintAdrDir(dir);
  if (problems.length) {
    for (const problem of problems) console.error(`adr:lint: ${problem}`);
    process.exit(1);
  }
  console.log(`adr:lint: ${path.relative(process.cwd(), dir) || '.'} OK`);
}
