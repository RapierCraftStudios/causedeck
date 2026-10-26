// @vitest-environment jsdom
// The court-day reminders card (#64): rows, optimistic saves with the saved check, rollback on error,
// the denied state, the skeleton and the error with retry, and keyboard operation of the controls.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RemindersCard,
  RemindersError,
  RemindersSkeleton,
} from '../app/(app)/w/[slug]/settings/notifications/_reminders-card.tsx';
import type { ReminderPrefsView } from '../app/(app)/w/[slug]/settings/notifications/reminders-actions.ts';

import { catalogs } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const WS = '00000000-0000-4000-8000-00000000a001';
const channels = { in_app: true, push: true, email: true };
const prefs: ReminderPrefsView = {
  evening: { enabled: true, time: '20:00', channels },
  morning: { enabled: true, time: '07:00', channels },
  outcome_missing: { enabled: true, delayMinutes: 90, channels },
};
const en = catalogs.en.reminders.settings;

function ui(node: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {node}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RemindersCard', () => {
  it('shows the three rows with the default time and delay', () => {
    ui(<RemindersCard workspaceId={WS} prefs={prefs} actions={{ set: vi.fn() }} />);
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy();
    for (const label of [en.evening.label, en.morning.label, en.outcomeMissing.label]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText<HTMLSelectElement>(en.time).value).toBe('20:00');
    expect(screen.getAllByRole('switch')).toHaveLength(9);
  });

  it('saves a channel switch, then shows the saved state', async () => {
    const next = {
      ...prefs,
      evening: { ...prefs.evening, channels: { ...channels, push: false } },
    };
    const set = vi.fn(() => Promise.resolve({ ok: true as const, data: next }));
    ui(<RemindersCard workspaceId={WS} prefs={prefs} actions={{ set }} />);
    const toggle = screen.getByLabelText(`${en.evening.label}: ${en.channels.push}`);
    // Keyboard operable: the switch takes focus and Space toggles it.
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    await act(() => {
      fireEvent.click(toggle);
      return Promise.resolve();
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        evening: { time: '20:00', channels: { ...channels, push: false } },
      }),
    );
    await waitFor(() => {
      expect(screen.getByText(en.saved)).toBeTruthy();
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('changes the evening time and the outcome delay from the selects', async () => {
    const set = vi.fn(() => Promise.resolve({ ok: true as const, data: prefs }));
    ui(<RemindersCard workspaceId={WS} prefs={prefs} actions={{ set }} />);
    await act(() => {
      fireEvent.change(screen.getByLabelText(en.time), { target: { value: '21:30' } });
      return Promise.resolve();
    });
    expect(set).toHaveBeenLastCalledWith(
      expect.objectContaining({ evening: { time: '21:30', channels } }),
    );
    await act(() => {
      fireEvent.change(screen.getByLabelText(en.delay), { target: { value: '60' } });
      return Promise.resolve();
    });
    expect(set).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome_missing: { delayMinutes: 60, channels } }),
    );
  });

  it('rolls back and says so on an error, and on a denied save', async () => {
    const set = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: 'x' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'FORBIDDEN', message: 'x' } });
    ui(<RemindersCard workspaceId={WS} prefs={prefs} actions={{ set }} />);
    const toggle = screen.getByLabelText(`${en.morning.label}: ${en.channels.email}`);
    await act(() => {
      fireEvent.click(toggle);
      return Promise.resolve();
    });
    expect(screen.getByText(en.error)).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(() => {
      fireEvent.click(toggle);
      return Promise.resolve();
    });
    expect(screen.getByText(en.denied)).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });
});

describe('states', () => {
  it('renders the skeleton while loading', () => {
    ui(<RemindersSkeleton />);
    expect(document.querySelector('[data-pattern-state="loading"]')).toBeTruthy();
  });

  it('renders the error with a retry that refreshes the route', () => {
    ui(<RemindersError />);
    fireEvent.click(screen.getByRole('button', { name: en.retry }));
    expect(router.refresh).toHaveBeenCalled();
  });
});
