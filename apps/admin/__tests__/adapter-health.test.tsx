// @vitest-environment jsdom
// The Adapters page (#312): one status chip per health status (icon and text label), the
// last-checked time, both empty states, and the registry-backed AdapterHealthSource.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdapterHealthTable } from '../components/adapter-health-table.tsx';
import {
  ADAPTER_HEALTH_STATUSES,
  registryHealthSource,
  type AdapterHealthEntry,
} from '../lib/adapter-health.ts';
import { adapterRegistry } from '../lib/data/index.ts';

vi.mock('../lib/data/index.ts', () => ({ adapterRegistry: vi.fn() }));

afterEach(cleanup);

const CHECKED = new Date('2026-10-20T04:30:00.000Z');

function entry(overrides: Partial<AdapterHealthEntry>): AdapterHealthEntry {
  return {
    adapterId: 'madras-hc',
    resource: 'case-status',
    mode: 'user_supplied',
    enabled: true,
    status: 'unknown',
    lastCheckedAt: null,
    ...overrides,
  };
}

describe('AdapterHealthTable', () => {
  it('renders a chip with an icon and a text label for every status', () => {
    const tones = { healthy: 'success', degraded: 'warning', down: 'danger', unknown: 'neutral' };
    const labels = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down', unknown: 'Unknown' };
    render(
      <AdapterHealthTable
        entries={ADAPTER_HEALTH_STATUSES.map((status) =>
          entry({ resource: status, status, lastCheckedAt: CHECKED }),
        )}
      />,
    );
    expect(screen.getAllByTestId('adapter-row')).toHaveLength(4);
    for (const status of ADAPTER_HEALTH_STATUSES) {
      const chip = document.querySelector(`[data-status="${status}"]`);
      expect(chip, status).not.toBeNull();
      expect(chip?.textContent).toBe(labels[status]);
      expect(chip?.getAttribute('data-tone')).toBe(tones[status]);
      expect(chip?.querySelector('svg[aria-hidden="true"]'), status).not.toBeNull();
    }
    expect(screen.queryByText(/No health data yet/)).toBeNull();
  });

  it('shows the last-checked time, or Never checked', () => {
    render(
      <AdapterHealthTable
        entries={[
          entry({ resource: 'case-status', status: 'healthy', lastCheckedAt: CHECKED }),
          entry({ resource: 'a2-retrieval' }),
        ]}
      />,
    );
    const [checked, never] = screen.getAllByTestId('adapter-row');
    const time = checked?.querySelector('time');
    expect(time?.getAttribute('dateTime')).toBe(CHECKED.toISOString());
    // 04:30 UTC is 10:00 in India.
    expect(time?.textContent).toMatch(/20 Oct 2026.*10:00/i);
    expect(within(never as HTMLElement).getByText('Never checked')).toBeTruthy();
  });

  it('shows No adapters registered yet. when the registry is empty', () => {
    render(<AdapterHealthTable entries={[]} />);
    expect(screen.getByText('No adapters registered yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows No health data yet when no row has been checked', () => {
    render(<AdapterHealthTable entries={[entry({}), entry({ adapterId: 'karnataka-hc' })]} />);
    expect(screen.getByRole('status').textContent).toMatch(/^No health data yet/);
    expect(screen.getAllByTestId('adapter-row')).toHaveLength(2);
  });
});

describe('registryHealthSource', () => {
  it('lists registry rows as unknown and never checked until Court Graph', async () => {
    vi.mocked(adapterRegistry).mockResolvedValue([
      {
        adapterId: 'madras-hc',
        resource: 'case-status',
        mode: 'user_supplied',
        enabled: true,
        reviewedAt: CHECKED,
      },
    ]);
    const staff = { userId: '00000000-0000-4000-8000-000000000001', role: 'ops' as const };
    expect(await registryHealthSource(staff).list()).toEqual([
      {
        adapterId: 'madras-hc',
        resource: 'case-status',
        mode: 'user_supplied',
        enabled: true,
        status: 'unknown',
        lastCheckedAt: null,
      },
    ]);
    expect(adapterRegistry).toHaveBeenCalledWith(staff);
  });
});
