// @vitest-environment jsdom
// The Status console (#770): empty state, incident list, the offline banner, the loading skeleton,
// and permission-denied (notFound) for staff without the `status` capability.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireStaff: vi.fn(), incidents: vi.fn() }));

vi.mock('../lib/staff.ts', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('../lib/data/index.ts', () => ({ incidentConsole: mocks.incidents }));
vi.mock('../app/(console)/status/actions.ts', () => ({
  createIncidentAction: vi.fn(),
  updateIncidentAction: vi.fn(),
}));

const { default: StatusPage } = await import('../app/(console)/status/page.tsx');
const { default: StatusLoading } = await import('../app/(console)/status/loading.tsx');
const { OfflineBanner } = await import('../app/(console)/status/offline-banner.tsx');

afterEach(cleanup);

const OPS = { userId: '0192d3b0-0000-7000-8000-000000000770', role: 'ops' as const };
const at = new Date('2026-10-25T10:00:00.000Z');
const incident = (over: Record<string, unknown>) => ({
  id: '3f9c1c1e-6a49-4d0e-8a77-0c5f0d6a1b11',
  title: 'Court lookups are slow',
  severity: 'degraded',
  state: 'investigating',
  component: 'court',
  startedAt: at,
  resolvedAt: null,
  updates: [{ state: 'investigating', body: 'We are investigating.', createdAt: at }],
  ...over,
});

async function renderPage() {
  render(await StatusPage({ searchParams: Promise.resolve({}) }));
}

describe('Status page', () => {
  it('shows the empty state and the open-incident form', async () => {
    mocks.requireStaff.mockResolvedValue(OPS);
    mocks.incidents.mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText('No incidents yet.')).toBeTruthy();
    expect(screen.getByText('Open an incident')).toBeTruthy();
    expect(mocks.requireStaff).toHaveBeenCalledWith('status');
  });

  it('lists open incidents with an update form and resolved ones without', async () => {
    mocks.requireStaff.mockResolvedValue(OPS);
    mocks.incidents.mockResolvedValue([
      incident({}),
      incident({
        id: '3f9c1c1e-6a49-4d0e-8a77-0c5f0d6a1b12',
        title: 'Storage blip',
        state: 'resolved',
        resolvedAt: at,
      }),
    ]);
    await renderPage();
    expect(screen.getByText('Court lookups are slow')).toBeTruthy();
    expect(screen.getByText('Storage blip')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Post update' })).toHaveLength(1);
  });

  it('shows the error banner from ?error=', async () => {
    mocks.requireStaff.mockResolvedValue(OPS);
    mocks.incidents.mockResolvedValue([]);
    render(await StatusPage({ searchParams: Promise.resolve({ error: 'Nope' }) }));
    expect(screen.getByRole('alert').textContent).toBe('Nope');
  });

  it('is denied (notFound) for non-staff', async () => {
    mocks.requireStaff.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(StatusPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(mocks.incidents).not.toHaveBeenCalledWith(undefined);
  });
});

describe('OfflineBanner', () => {
  it('toggles on the offline and online events', () => {
    render(<OfflineBanner />);
    expect(screen.queryByText(/You are offline/)).toBeNull();
    act(() => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(/You are offline/)).toBeTruthy();
    act(() => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/You are offline/)).toBeNull();
  });
});

describe('loading skeleton', () => {
  it('renders busy', () => {
    render(<StatusLoading />);
    expect(screen.getByLabelText('Loading status incidents').getAttribute('aria-busy')).toBe(
      'true',
    );
  });
});
