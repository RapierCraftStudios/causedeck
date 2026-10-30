import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { StatusSnapshot } from '../../lib/status/model.ts';

import { OverallBanner } from './overall-banner.tsx';
import { StatusView, type StatusViewState } from './status-view.tsx';

const snapshot: StatusSnapshot = {
  version: 1,
  generatedAt: '2026-10-25T10:00:00.000Z',
  overall: 'down',
  components: [{ id: 'court', name: 'x', status: 'down' }],
  incidents: [
    {
      id: '3f9c1c1e-6a49-4d0e-8a77-0c5f0d6a1b11',
      title: 'Outage',
      severity: 'down',
      state: 'investigating',
      component: 'court',
      startedAt: '2026-10-25T08:00:00.000Z',
      resolvedAt: null,
      updates: [{ state: 'investigating', body: 'Looking.', at: '2026-10-25T09:00:00.000Z' }],
    },
  ],
  signature: { alg: 'HS256', value: '0'.repeat(64) },
};
const html = (state: StatusViewState, online = true) =>
  renderToStaticMarkup(
    <StatusView state={state} online={online} now={new Date('2026-10-25T10:00:00Z')} />,
  );

describe('status components', () => {
  it('pairs an icon with text and a live region', () => {
    const out = html({ kind: 'ok', snapshot });
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('role="status"');
    expect(out).toContain('Some systems are down');
    expect(out).toContain('data-icon="cross"');
    expect(out).toContain('Parsing of documents you share');
  });
  it('shows IST and UTC timestamps in time elements', () => {
    const out = html({ kind: 'ok', snapshot });
    expect(out).toMatch(
      /<time dateTime="2026-10-25T08:00:00.000Z"[^>]*>25 Oct 2026, 13:30 IST \/ 25 Oct 2026, 08:00 UTC<\/time>/,
    );
  });
  it('renders the failure and edge states', () => {
    expect(html({ kind: 'unavailable' })).toContain('Status unavailable, retry');
    expect(html({ kind: 'unverified' })).toContain('Status data could not be verified');
    expect(html({ kind: 'stale', snapshot, ageSec: 900 })).toContain('more than 5 minutes ago');
    expect(html({ kind: 'loading' })).toContain('aria-busy="true"');
    expect(html({ kind: 'ok', snapshot }, false)).toContain('You are offline');
    expect(renderToStaticMarkup(<OverallBanner overall="operational" />)).toContain(
      'All systems operational',
    );
  });
});
