// eCourts template adapter units (#634): option lists and code maps, cause-list rows and anchors,
// orders, and total behaviour on malformed input. Page fixtures are checked in
// src/status/fixtures.test.ts. Runs in `test:golden`; no database.
import { describe, expect, it } from 'vitest';

import { ParsedCauseListSchema } from '../types.ts';

import {
  caseTypeShortForm,
  createCodeMap,
  parseEcourtsCauseList,
  parseEcourtsOrders,
  parseEcourtsStatus,
  parseOptionList,
  readEcourtsCodeMaps,
} from './index.ts';

const OPTIONS = `<select id="case_type"><option value="">Select Case Type</option>
  <option value="11">Original Suit - OS</option>
  <option value="12"> Civil  Appeal - CA </option></select>`;

describe('option lists and code maps', () => {
  it('reads options, skips placeholders and looks codes up both ways', () => {
    expect(parseOptionList(OPTIONS, 'case_type')).toEqual([
      { code: '11', label: 'Original Suit - OS' },
      { code: '12', label: 'Civil Appeal - CA' },
    ]);
    const { caseType } = readEcourtsCodeMaps(OPTIONS);
    expect(caseType.labelOf('12')).toBe('Civil Appeal - CA');
    expect(caseType.codeOf('original suit - os')).toBe('11');
    expect(caseType.codeOf('missing')).toBeNull();
    expect(caseTypeShortForm('Original Suit - OS')).toBe('OS');
  });

  it('keeps the first entry of a repeated code or label', () => {
    const map = createCodeMap([
      { code: '1', label: 'A' },
      { code: '1', label: 'B' },
    ]);
    expect(map.labelOf('1')).toBe('A');
  });

  it('gives empty maps for markup without the drop-downs', () => {
    expect(readEcourtsCodeMaps('<<<').state.entries).toEqual([]);
    expect(parseOptionList('', 'x')).toEqual([]);
  });
});

describe('cause list parser', () => {
  const html = `<h2>Cause List for 21-10-2026</h2><table>
    <tr><th>Sr No</th><th>Case Number</th><th>Party Name</th></tr>
    <tr><td colspan="3">Court No. 4 - Civil Judge</td></tr>
    <tr><td>1</td><td>CS/12/2026</td><td>A vs B</td></tr>
    <tr><td>2</td><td>garbled</td><td>C vs D</td></tr></table>`;

  it('anchors each row on its case-number cell and keeps unreadable rows', () => {
    const list = parseEcourtsCauseList(html, { forumCode: 'in.x.district' });
    expect(ParsedCauseListSchema.parse(list)).toEqual(list);
    expect(list.listDate).toBe('2026-10-21');
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      hallNo: '4',
      bench: 'Civil Judge',
      matchKey: 'CS/12/2026',
      anchor: { quote: 'CS/12/2026', rowIndex: 0 },
    });
    expect(list.unparsedRows?.[0]?.anchor.quote).toBe('garbled');
  });

  it('never throws and reports unreadable input as not a cause list', () => {
    for (const bad of ['', '<<<', '<table><tr><td>', 'plain text', '\u0000<td></table>']) {
      const list = parseEcourtsCauseList(bad, { forumCode: 'in.x.district' });
      expect(list.status).toBe('not_a_cause_list');
      expect(list.rows).toEqual([]);
    }
  });

  it('reports a header-only list as empty', () => {
    const list = parseEcourtsCauseList(
      '<table><tr><th>Sr No</th><th>Case Number</th></tr></table>',
      { forumCode: 'in.x.district' },
    );
    expect(list.status).toBe('empty');
  });
});

describe('orders and status parsers', () => {
  const orders = `<table><tr><th>Order Number</th><th>Order Date</th><th>Order Details</th></tr>
    <tr><td>1</td><td>21-03-2025</td><td><a href="/o.pdf">Order</a> summons</td></tr></table>`;

  it('read the orders table', () => {
    expect(parseEcourtsOrders(orders)).toEqual([
      { date: '2025-03-21', number: '1', summary: 'Order summons', href: '/o.pdf' },
    ]);
    expect(parseEcourtsOrders('<<<')).toEqual([]);
  });

  it('reuse the district status parser', () => {
    expect(parseEcourtsStatus('').status).toBe('unrecognised');
    expect(parseEcourtsStatus(orders).orders).toEqual(parseEcourtsOrders(orders));
  });
});
