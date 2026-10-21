// The HTML layout reader (#370): visible text as lines, table rows as tab-joined cells, and never
// the content of scripts, styles or comments, which parse5 reads as data and nothing runs.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ECHO_FORUM_CODE,
  createEchoAdapter,
  layoutFromHtml,
  LayoutDocumentSchema,
} from '../index.ts';

const LIST_HTML = `<!doctype html>
<html>
  <head><title>Ignored title</title><style>p { color: red }</style></head>
  <body>
    <h1>ECHO TEST COURT (FICTIONAL)</h1>
    <!-- a comment that is not text -->
    <p>COURT HALL 1</p>
    <p>FOR   ADMISSION</p>
    <table>
      <tr><td>1. W.P. No. 12345 of 2026</td><td>Arun Kavitham vs Fictional District Collector</td></tr>
    </table>
    <div>Line one<br>Line two &amp; more</div>
    <script>app.alert("pwned")</script>
    <noscript>Enable JavaScript</noscript>
  </body>
</html>`;

describe('layoutFromHtml', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads visible text as lines and table cells joined by tabs', () => {
    const layout = layoutFromHtml(LIST_HTML);
    expect(LayoutDocumentSchema.parse(layout)).toEqual(layout);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]).toMatchObject({
      page: 1,
      width: 0,
      height: 0,
      items: [],
      words: [],
      textCoverage: 1,
    });
    expect(layout.pages[0]?.text.split('\n')).toEqual([
      'ECHO TEST COURT (FICTIONAL)',
      'COURT HALL 1',
      'FOR ADMISSION',
      '1. W.P. No. 12345 of 2026\tArun Kavitham vs Fictional District Collector',
      'Line one',
      'Line two & more',
    ]);
  });

  it('skips scripts, styles, comments and the head without running anything', () => {
    const alert = vi.fn();
    vi.stubGlobal('app', { alert });
    const text = layoutFromHtml(LIST_HTML).pages[0]?.text ?? '';
    for (const hidden of ['app.alert', 'color: red', 'a comment', 'Ignored title', 'Enable']) {
      expect(text).not.toContain(hidden);
    }
    expect(alert).not.toHaveBeenCalled();
  });

  it('reports textCoverage 0 for a document without visible text', () => {
    for (const html of ['', '   ', '<html><body><script>1</script></body></html>']) {
      expect(layoutFromHtml(html).pages).toEqual([
        { page: 1, width: 0, height: 0, text: '', items: [], words: [], textCoverage: 0 },
      ]);
    }
  });

  it('keeps line breaks inside pre', () => {
    expect(layoutFromHtml('<pre>COURT HALL 2\nFOR ORDERS</pre>').pages[0]?.text).toBe(
      'COURT HALL 2\nFOR ORDERS',
    );
  });

  it('feeds the adapter contract: echo rows anchor in the HTML text', async () => {
    const html =
      '<p>COURT HALL 1</p><p>FOR ADMISSION</p><p>1. W.P. No. 12345 of 2026 Arun Kavitham vs Fictional District Collector</p>';
    const parsed = await createEchoAdapter().parseCauseList({
      kind: 'layout',
      layout: layoutFromHtml(html),
      meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: ECHO_FORUM_CODE },
    });
    expect(parsed.rows.map((row) => row.anchor)).toEqual([
      {
        page: 1,
        quote: '1. W.P. No. 12345 of 2026 Arun Kavitham vs Fictional District Collector',
        rowIndex: 0,
      },
    ]);
  });
});
