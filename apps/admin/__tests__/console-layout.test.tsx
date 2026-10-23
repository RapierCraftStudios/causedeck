// @vitest-environment jsdom
// The console shell (#309): the STAFF CONSOLE strip with a STAFF label and environment tag, and the
// six-item nav filtered by the staff role matrix.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CONSOLE_NAV, ConsoleNav, navItemsFor } from '../components/console-nav.tsx';
import { StaffStrip } from '../components/staff-strip.tsx';
import { adminEnvLabel } from '../lib/env.ts';

afterEach(cleanup);

describe('StaffStrip', () => {
  it('labels the console, the staff member and the environment', () => {
    render(<StaffStrip envLabel="staging" email="ops@causedeck.test" role="ops" />);
    const strip = screen.getByTestId('staff-strip');
    expect(within(strip).getByText('Staff console')).toBeTruthy();
    expect(within(strip).getByText('STAFF')).toBeTruthy();
    expect(screen.getByTestId('env-tag').textContent).toBe('staging');
    expect(screen.getByTestId('env-tag').className).toContain('bg-warning-soft');
    expect(within(strip).getByText('ops@causedeck.test · ops')).toBeTruthy();
  });

  it('tints production red', () => {
    render(<StaffStrip envLabel="production" email="a@causedeck.test" role="admin" />);
    expect(screen.getByTestId('env-tag').className).toContain('bg-danger-soft');
  });
});

describe('adminEnvLabel', () => {
  it('uses ADMIN_ENV_LABEL, else production or development from NODE_ENV', () => {
    expect(adminEnvLabel({ NODE_ENV: 'production', ADMIN_ENV_LABEL: 'staging' })).toBe('staging');
    expect(adminEnvLabel({ NODE_ENV: 'production', ADMIN_ENV_LABEL: undefined })).toBe(
      'production',
    );
    expect(adminEnvLabel({ NODE_ENV: 'development', ADMIN_ENV_LABEL: undefined })).toBe(
      'development',
    );
  });
});

describe('ConsoleNav', () => {
  it('has the six console areas in order', () => {
    expect(CONSOLE_NAV.map((item) => item.label)).toEqual([
      'Overview',
      'Adapters',
      'Flags',
      'Workspaces',
      'Support sessions',
      'Audit',
    ]);
  });

  it('shows admin every item', () => {
    render(<ConsoleNav role="admin" />);
    const nav = screen.getByRole('navigation', { name: 'Console' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([
      'Overview',
      'Adapters',
      'Sources',
      'Flags',
      'Workspaces',
      'Support sessions',
      'Audit',
    ]);
  });

  it('filters items by role', () => {
    expect(navItemsFor('support').map((i) => i.href)).toEqual([
      '/',
      '/workspaces',
      '/support',
      '/audit',
    ]);
    expect(navItemsFor('ops').map((i) => i.href)).toEqual([
      '/',
      '/adapters',
      '/sources',
      '/flags',
      '/audit',
    ]);
  });
});
