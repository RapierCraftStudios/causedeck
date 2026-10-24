// The committed status-page fixtures (#590): per template, every `*.input.html` listed in its
// manifest parses to its `*.expected.json`. All pages are synthetic and FICTIONAL. Runs in
// `test:golden` (vitest.golden.config.ts); no database.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseEcourtsCauseList,
  parseEcourtsOrders,
  readEcourtsCodeMaps,
} from '../ecourts/index.ts';
import { FIXTURES_ROOT } from '../testing/golden.ts';

import {
  CASE_STATUS_TEMPLATES,
  ParsedCaseStatusSchema,
  parseCaseStatus,
  type CaseStatusTemplate,
} from './index.ts';

const root = path.join(FIXTURES_ROOT, 'status');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');

const manifest = JSON.parse(read('manifest.json')) as {
  fixtures: {
    template: CaseStatusTemplate;
    file: string;
    classification: string;
    /** Page type; absent means a status page. */
    page?: 'status' | 'orders' | 'cause_list' | 'options';
  }[];
};

/** Parses one fixture page the way its page type is read (#634). */
function parsePage(
  template: CaseStatusTemplate,
  page: string,
  file: string,
  html: string,
): unknown {
  if (page === 'orders') return parseEcourtsOrders(html);
  if (page === 'cause_list') {
    const forum = file.replace('cause-list-', '').replace('.input.html', '');
    return parseEcourtsCauseList(html, { forumCode: `in.${forum}.district` });
  }
  if (page === 'options') {
    return Object.fromEntries(
      Object.entries(readEcourtsCodeMaps(html)).map(([key, map]) => [key, map.entries]),
    );
  }
  return ParsedCaseStatusSchema.parse(parseCaseStatus(template, html));
}

describe('status fixtures', () => {
  for (const template of CASE_STATUS_TEMPLATES) {
    const entries = manifest.fixtures.filter((entry) => entry.template === template);

    describe(template, () => {
      it('lists at least three fictional fixtures', () => {
        expect(entries.length).toBeGreaterThanOrEqual(3);
        for (const entry of entries) expect(entry.classification).toBe('FICTIONAL');
      });

      for (const entry of entries) {
        it(`parses ${entry.file} to its expected file`, () => {
          const html = read(template, entry.file);
          const parsed = parsePage(template, entry.page ?? 'status', entry.file, html);
          expect(parsed).toEqual(
            JSON.parse(read(template, entry.file.replace('.input.html', '.expected.json'))),
          );
        });
      }
    });
  }
});

describe('eCourts fixtures (#634)', () => {
  const entries = manifest.fixtures.filter((entry) => entry.template === 'ecourts-district');

  it('cover status, cause-list and orders pages for five states', () => {
    for (const state of ['tn', 'ka', 'mh', 'dl', 'up']) {
      for (const [page, prefix] of [
        ['status', 'status'],
        ['cause_list', 'cause-list'],
        ['orders', 'orders'],
      ] as const) {
        expect(entries).toContainEqual(
          expect.objectContaining({ page, file: `${prefix}-${state}.input.html` }),
        );
      }
    }
  });
});

describe('case status parsers', () => {
  const templates: readonly CaseStatusTemplate[] = CASE_STATUS_TEMPLATES;

  it('never throw on malformed input and report it as unrecognised', () => {
    for (const template of templates) {
      for (const html of ['', '<<<', '<table><tr><td>', 'plain text', '\u0000<td></table>']) {
        const parsed = parseCaseStatus(template, html);
        expect(parsed.status).toBe('unrecognised');
        expect(parsed.orders).toEqual([]);
      }
    }
  });

  it('read the same page the same way twice (pure)', () => {
    const html = read('madras-hc', 'status-01-admitted.input.html');
    expect(parseCaseStatus('madras-hc', html)).toEqual(parseCaseStatus('madras-hc', html));
  });

  it('keep the verbatim cell text of each value as its quote', () => {
    const parsed = parseCaseStatus(
      'ecourts-district',
      read('ecourts-district', 'status-01-evidence.input.html'),
    );
    expect(parsed.quotes.nextHearingDate).toBe('14th November 2026');
    expect(parsed.nextHearingDate).toBe('2026-11-14');
  });
});
