// The Karnataka HC HTML cause-list parser (#405) on inline FICTIONAL list pages: per-hall blocks,
// header synonyms, unclosed tags, nested tables, the publication stamp, link text as the case
// number, stage headings, list types and the degradation statuses.
import { describe, expect, it } from 'vitest';

import { evaluateParseHealth, parseRunMetrics } from '../health/monitor.ts';
import { layoutFromHtml } from '../layout/html.ts';
import { ParsedCauseListSchema, type ParsedCauseList, type ParserInput } from '../types.ts';

import { KARNATAKA_HC_CONFIG, KARNATAKA_HC_VERSION } from './index.ts';
import { parseKarnatakaCauseListHtml } from './parse-cause-list-html.ts';

const FORUM = 'in.ka.karnataka-hc.bengaluru';
const options = { config: KARNATAKA_HC_CONFIG, version: KARNATAKA_HC_VERSION };

function parse(html: string, fileName?: string): ParsedCauseList {
  const input: ParserInput = {
    kind: 'html',
    html,
    meta: {
      receivedAt: '2026-10-21T20:00:00+05:30',
      forumCode: FORUM,
      ...(fileName === undefined ? {} : { fileName }),
    },
  };
  return ParsedCauseListSchema.parse(parseKarnatakaCauseListHtml(input, options));
}

const HEADER =
  '<tr><th>Sl. No.</th><th>Case No.</th><th>Petitioner / Respondent</th>' +
  '<th>Advocate for Petitioner</th><th>Advocate for Respondent</th></tr>';

const LIST = `<!doctype html><html><body>
<h2>HIGH COURT OF KARNATAKA, BENGALURU</h2>
<h3>DAILY CAUSE LIST FOR 22-10-2026</h3>
<p>Last Causelist Updated on : 21-10-2026 06:30 PM</p>
<div><b>COURT HALL NO. 1</b></div>
<div>LIST NO. 1</div>
<div>HON'BLE MR. JUSTICE A. FICTIONAL</div>
<table>
${HEADER}
<tr><td colspan="5">PRELIMINARY HEARING</td></tr>
<tr><td>1</td><td><a href="#case">WP No. 12345/2026</a> (GM-RES)</td><td>Arun Kavitham vs State of Fictionland</td><td>Sri. A.B. Fictional KAR/1234/2001</td><td>Smt. C. Madeup</td></tr>
<tr><td>2</td><td><a href="#case">WA No. 100150 of 2024</a></td><td>Fictional Mills vs Union</td><td>Sri. D. Imaginary</td><td></td></tr>
<tr><td colspan="5">HEARING ON IA</td></tr>
<tr><td>3</td><td>IA No. 1/2026 in RFA No. 100/2024</td><td>X vs Y</td><td></td><td></td></tr>
<tr><td colspan="5">ORDERS</td></tr>
<tr><td>4</td><td>CRL.P No. 100137 of 2025</td><td>P vs State</td><td>Sri. E. Pretend</td><td>SPP</td></tr>
<tr><td colspan="5">MOVED BY THE REGISTRY</td></tr>
<tr><td>5</td><td>No number printed</td><td>Q vs R</td><td></td><td></td></tr>
</table>
<div>COURT HALL NO. 2</div>
<div>HON'BLE MRS. JUSTICE B. INVENTED</div>
<table>
<tr><th>S.No</th><th>Case Number</th><th>Parties</th><th>Petitioner Advocate</th><th>Advocate for Respondent</th></tr>
<tr><td colspan="5">FOR BEING SPOKEN TO</td></tr>
<tr><td>1</td><td>RSA No. 55/2023</td><td>M vs N</td><td>Sri. F. Fable</td><td>Sri. G. Myth</td></tr>
</table>
</body></html>`;

describe('parseKarnatakaCauseListHtml (#405)', () => {
  it('reads per-hall blocks, matched header synonyms and link text as the case number', () => {
    const list = parse(LIST);
    expect(list.status).toBe('ok');
    expect(list.source).toBe('html');
    expect(list.diagnostics.hallsSeen).toEqual(['1', '2']);
    expect(list.rows.map((row) => [row.hallNo, row.itemNo, row.matchKey])).toEqual([
      ['1', '1', 'WP/12345/2026'],
      ['1', '2', 'WA/100150/2024'],
      ['1', '3', 'RFA/100/2024'],
      ['1', '4', 'CRLP/100137/2025'],
      ['2', '1', 'RSA/55/2023'],
    ]);
    const [first, second] = list.rows;
    // The link text alone is the case number; the bracketed category is kept after it.
    expect(first).toMatchObject({
      caseTypeRaw: 'WP',
      caseNumber: '12345',
      caseYear: 2026,
      parties: 'Arun Kavitham vs State of Fictionland',
      bench: "HON'BLE MR. JUSTICE A. FICTIONAL",
      listNo: '1',
    });
    expect(first?.advocates?.map((a) => a.enrolmentNo ?? null)).toEqual(['KAR/1234/2001', null]);
    expect(second?.benchNumbering).toBe('100xxx');
    expect(list.rows[2]?.children?.[0]).toMatchObject({ caseTypeCode: 'IA', number: '1' });
    expect(list.rows[4]?.bench).toBe("HON'BLE MRS. JUSTICE B. INVENTED");
    // Every anchor quotes the page text `layoutFromHtml` reads.
    const text = layoutFromHtml(LIST).pages[0]?.text ?? '';
    for (const row of list.rows) expect(text).toContain(row.anchor.quote);
  });

  it('keeps the bracketed category when the case number is plain text', () => {
    const list = parse(
      `<div>COURT HALL NO. 3</div><table>${HEADER}<tr><td colspan=5>ADMISSION</td></tr>` +
        '<tr><td>1</td><td>W.P. No. 12345 of 2026 (GM-RES)</td><td>A vs B</td><td>X</td><td>Y</td></tr></table>',
    );
    expect(list.rows[0]).toMatchObject({ subCategory: 'GM-RES', stageNorm: 'admission' });
  });

  it('separates publishedAt (the stamp, the evening before) from listDate', () => {
    const list = parse(LIST);
    expect(list.publishedAt).toBe('2026-10-21T18:30:00+05:30');
    expect(list.listDate).toBe('2026-10-22');
    expect(list.listDateAnchor?.quote).toBe('DAILY CAUSE LIST FOR 22-10-2026');
  });

  it('maps stage headings, counts unmapped ones and flags rows under Orders', () => {
    const list = parse(LIST);
    expect(list.rows.map((row) => row.stageNorm)).toEqual([
      'preliminary_hearing',
      'preliminary_hearing',
      'hearing_on_ia',
      'orders',
      'being_spoken_to',
    ]);
    expect(list.rows.map((row) => row.registryObjection)).toEqual([null, null, null, true, null]);
    expect(list.diagnostics.unmappedHeadings).toEqual(['MOVED BY THE REGISTRY']);
    // The row under the unmapped heading has no case number: returned unparsed, with its anchor.
    expect(list.unparsedRows).toEqual([
      {
        anchor: { page: 1, quote: '5\tNo number printed\tQ vs R', rowIndex: 0 },
        text: '5\tNo number printed\tQ vs R',
        reason: 'case_number_unparseable',
      },
    ]);
  });

  it('tolerates unclosed tags and a list table nested in a layout table', () => {
    const html = `<table><tr><td>
      <div>COURT HALL NO. 7
      <table>
      <tr><th>Sl.No<th>Case No<th>Petitioner / Respondent<th>Advocate for Petitioner<th>Advocate for Respondent
      <tr><td colspan=5>FOR HEARING
      <tr><td>1<td><a href=#>MFA No. 10/2025</a><td>A vs B<td>Sri. H<td>Sri. I
      <tr><td>2<td><a href=#>CRL.A No. 20/2025</a><td>C vs State<td>Sri. J<td>SPP
      </table>
    </td></tr></table>`;
    const list = parse(html);
    expect(list.status).toBe('ok');
    expect(list.rows.map((row) => [row.hallNo, row.matchKey, row.stageNorm])).toEqual([
      ['7', 'MFA/10/2025', 'final_hearing'],
      ['7', 'CRLA/20/2025', 'final_hearing'],
    ]);
  });

  it('parses a list without advocate columns with advocates: []', () => {
    const list = parse(
      '<div>COURT HALL NO. 4</div><table><tr><th>SL NO</th><th>CASE NO</th><th>PARTIES</th></tr>' +
        '<tr><td>1</td><td>CRP No. 9/2026</td><td>A vs B</td></tr></table>',
    );
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.advocates).toEqual([]);
  });

  it('reads advance, daily and supplementary lists from the title, else the file name', () => {
    const body = `<div>COURT HALL NO. 1</div><table>${HEADER}<tr><td>1</td><td>WP 1/2026</td><td>A</td><td>B</td><td>C</td></tr></table>`;
    expect(parse(`<h3>ADVANCE CAUSE LIST</h3>${body}`).listType).toBe('advance');
    expect(parse(`<h3>SUPPLEMENTARY CAUSE LIST</h3>${body}`).listType).toBe('supplementary');
    expect(parse(`<h3>DAILY CAUSE LIST</h3>${body}`).listType).toBe('daily');
    expect(parse(`<h3>CAUSE LIST</h3>${body}`, 'khc_advance_list_23-10-2026.html').listType).toBe(
      'advance',
    );
    expect(parse(`<h3>CAUSE LIST</h3>${body}`).listType).toBeNull();
    expect(parse(`<h3>ADVANCE CAUSE LIST</h3>${body}`).rows[0]?.listType).toBe('advance');
  });

  it('degrades: not a list, a list with zero rows (failed health) and an empty list', () => {
    const order = parse(
      '<p>IN THE HIGH COURT OF KARNATAKA AT BENGALURU</p><p>ORDER</p><p>Heard the learned counsel.</p>',
    );
    expect(order.status).toBe('not_a_cause_list');

    const zero = parse(
      `<h3>DAILY CAUSE LIST</h3><div>COURT HALL NO. 1</div><table>${HEADER}</table>`,
    );
    expect(zero.status).toBe('failed');
    expect(evaluateParseHealth(parseRunMetrics(zero)).status).toBe('failed');

    const empty = parse(
      '<h3>DAILY CAUSE LIST</h3><div>COURT HALL NO. 1</div><p>NO CASES LISTED</p>',
    );
    expect(empty.status).toBe('empty');
    expect(evaluateParseHealth(parseRunMetrics(empty)).status).not.toBe('failed');

    expect(parse('').status).toBe('failed');
  });

  it('gives identical JSON for identical input', () => {
    expect(JSON.stringify(parse(LIST))).toBe(JSON.stringify(parse(LIST)));
  });
});
