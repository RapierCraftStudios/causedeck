// @vitest-environment jsdom
// The case-status watch UI (#593): the watch list and the proceedings panel render only parsed
// fields and the provenance of a refresh; no captcha image, canvas, iframe or embedded court page is
// ever in the markup, and the refresh control shows how it was served.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusWatchPanel } from '../components/matters/status-watch-panel.tsx';
import { WatchForm } from '../app/(app)/w/[slug]/settings/case-watch/watch-form.tsx';

import { catalogs } from './helpers/intl.ts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const WS = '00000000-0000-4000-8000-00000000a001';
const refresh = {
  server: vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      data: {
        outcome: 'changed' as const,
        proposals: 1,
        tierUsed: 'alterlab-t2',
        costDollars: 0.25,
      },
    }),
  ),
  recordDevice: vi.fn(),
};

const wrap = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      {node}
    </NextIntlClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('case-watch UI', () => {
  it('lists watches with Refresh status and shows the server provenance, with no captcha or court page', async () => {
    const { container } = wrap(
      <WatchForm
        workspaceId={WS}
        watches={[
          {
            id: 'w1',
            proceedingId: 'p1',
            sourceId: 'in.tn.chennai-district:case_status',
            cnr: 'KABC010012342024',
            caseNumber: null,
            cadenceMinutes: 1440,
            lastPolledAt: null,
          },
        ]}
        remove={vi.fn()}
        refresh={refresh}
      />,
    );
    expect(screen.getByText(/KABC010012342024/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: catalogs.en.caseWatch.refresh.label }));
    await waitFor(() => {
      expect(refresh.server).toHaveBeenCalledWith({ workspaceId: WS, watchId: 'w1' });
    });
    await waitFor(() => {
      expect(container.textContent).toContain('alterlab-t2');
    });
    expect(
      container.querySelector('iframe, img, canvas, object, embed, input[type="text"]'),
    ).toBeNull();
  });

  it('the proceedings panel offers Watch for an unwatched proceeding and Refresh for a watched one', () => {
    const { container } = wrap(
      <StatusWatchPanel
        workspaceId={WS}
        sources={['in.tn.chennai-district:case_status']}
        actions={{ add: vi.fn(), refresh }}
        targets={[
          {
            proceedingId: 'p1',
            label: 'WP 1/2024',
            cnr: null,
            caseNumber: 'WP 1/2024',
            watchId: null,
          },
          {
            proceedingId: 'p2',
            label: 'WP 2/2024',
            cnr: null,
            caseNumber: 'WP 2/2024',
            watchId: 'w2',
          },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: catalogs.en.caseWatch.watch })).toBeTruthy();
    expect(screen.getByRole('button', { name: catalogs.en.caseWatch.refresh.label })).toBeTruthy();
    expect(container.querySelector('iframe, img, canvas, object, embed')).toBeNull();
  });
});
