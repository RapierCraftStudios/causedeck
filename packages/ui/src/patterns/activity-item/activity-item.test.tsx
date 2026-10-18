// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTIVITIES, NOW, SOURCES } from '../__fixtures__/trust';
import { ActivityEmpty, ActivityItem, ActivityItemSkeleton, relativeTime } from './activity-item';
import { UndoButton, undoWindow } from './undo-button';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../../components/sonner', () => ({ toast }));

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(() => {
  toast.mockReset();
});

describe('undoWindow', () => {
  it('counts whole days left in the 7-day window', () => {
    expect(undoWindow(ago(DAY), NOW)).toMatchObject({ expired: false, remainingDays: 6 });
    expect(undoWindow(ago(6.5 * DAY), NOW)).toMatchObject({ remainingDays: 0, remainingHours: 12 });
  });

  it('expires exactly 7 days after the change', () => {
    expect(undoWindow(ago(7 * DAY - 1), NOW).expired).toBe(false);
    expect(undoWindow(ago(7 * DAY), NOW).expired).toBe(true);
    expect(undoWindow(ago(7 * DAY), NOW).endsAt).toEqual(NOW);
  });
});

describe('UndoButton', () => {
  it('shows the countdown `Undo available for 6 days`', () => {
    render(<UndoButton performedAt={ago(DAY)} now={NOW} onUndo={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).toHaveAccessibleDescription('Undo available for 6 days');
  });

  it('counts hours on the last day and says `1 day` in the singular', () => {
    const { rerender } = render(<UndoButton performedAt={ago(6 * DAY)} now={NOW} />);
    expect(screen.getByText('Undo available for 1 day')).toBeInTheDocument();
    rerender(<UndoButton performedAt={ago(6.75 * DAY)} now={NOW} />);
    expect(screen.getByText('Undo available for 6 hours')).toBeInTheDocument();
  });

  it('replaces the button with `Undo window ended` after expiry', () => {
    render(<UndoButton performedAt={ago(8 * DAY)} now={NOW} onUndo={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Undo window ended')).toBeInTheDocument();
  });

  it('undoes from the keyboard, shows a toast with Redo and announces `Undone`', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <UndoButton
        performedAt={ago(DAY)}
        now={NOW}
        description="Moved the next hearing"
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Undone');
    expect(toast).toHaveBeenCalledOnce();
    const [title, options] = toast.mock.calls[0] as [
      string,
      { description: string; action: { label: string; onClick: () => void } },
    ];
    expect(title).toBe('Undone');
    expect(options.description).toBe('Moved the next hearing');
    expect(options.action.label).toBe('Redo');
    options.action.onClick();
    expect(onRedo).toHaveBeenCalledOnce();
    expect(await screen.findByText('Restored')).toBeInTheDocument();
  });

  it('is disabled with the reason while offline', () => {
    render(<UndoButton performedAt={ago(DAY)} now={NOW} offline onUndo={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/offline/);
  });
});

describe('relativeTime', () => {
  it('uses the largest whole unit', () => {
    expect(relativeTime(ago(DAY), NOW, 'en')).toBe('yesterday');
    expect(relativeTime(ago(3 * DAY), NOW, 'en')).toBe('3 days ago');
    expect(relativeTime(ago(2 * 60 * 60 * 1000), NOW, 'en')).toBe('2 hours ago');
    expect(relativeTime(NOW, NOW, 'en')).toBe('now');
  });
});

describe('ActivityItem', () => {
  const { attached } = ACTIVITIES;

  it('shows who, what, source, level and time with the absolute time', () => {
    render(<ActivityItem {...attached} now={NOW} onUndo={vi.fn()} />);
    const row = screen.getByText(attached.sentence).closest('[data-slot="activity-item"]');
    if (!(row instanceof HTMLElement)) throw new Error('no row');
    expect(
      within(row).getByText('Lawyer OS', { selector: '[data-slot="activity-actor"]' }),
    ).toBeVisible();
    expect(row.querySelector('[data-slot="provenance-chip"]')).toHaveAttribute(
      'data-source-state',
      'confirmed',
    );
    expect(row.querySelector('[data-slot="level-badge"]')).toHaveAttribute('data-level', 'L3');
    const time = row.querySelector('time');
    expect(time).toHaveTextContent('yesterday');
    expect(time).toHaveAttribute('dateTime', attached.at);
    expect(time).toHaveAccessibleName('17 Oct 2026, 10:00 am');
    expect(within(row).getByRole('button', { name: 'Undo' })).toHaveAccessibleDescription(
      'Undo available for 6 days',
    );
  });

  it('fades to 60% with an `Undone` label after Undo, and returns on Redo', async () => {
    const user = userEvent.setup();
    const { container } = render(<ActivityItem {...attached} now={NOW} onUndo={vi.fn()} />);
    const row = container.querySelector('[data-slot="activity-item"]');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(row).toHaveAttribute('data-undone');
    expect(row?.querySelector('[data-slot="activity-icon"]')).toHaveClass('opacity-60');
    expect(row?.querySelector('[data-slot="activity-rail"]')).toHaveClass('opacity-60');
    expect(row?.querySelector('[data-slot="activity-sentence"]')).toHaveClass('text-ink-muted');
    expect(screen.getByText('Undone', { selector: '[data-slot="activity-undone"]' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Undone');

    const [, options] = toast.mock.calls[0] as [string, { action: { onClick: () => void } }];
    act(() => {
      options.action.onClick();
    });
    expect(row).not.toHaveAttribute('data-undone');
  });

  it('follows a controlled undone state', () => {
    const { container } = render(<ActivityItem {...attached} now={NOW} undone onUndo={vi.fn()} />);
    expect(container.querySelector('[data-slot="activity-item"]')).toHaveAttribute('data-undone');
  });

  it('shows `Undo window ended` for old changes', () => {
    render(<ActivityItem {...ACTIVITIES.expired} now={NOW} onUndo={vi.fn()} />);
    expect(screen.getByText('Undo window ended')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('hides Undo for view-only viewers and disables it offline', () => {
    const { rerender } = render(<ActivityItem {...attached} now={NOW} viewOnly onUndo={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByText('View only')).toBeInTheDocument();
    rerender(<ActivityItem {...attached} now={NOW} offline onUndo={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('shows an error and never offers a send, file or pay action', () => {
    render(
      <ActivityItem
        {...attached}
        source={SOURCES.proposed}
        now={NOW}
        error="Could not undo. Try again."
        onUndo={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not undo');
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(/\b(send|file|pay)\b/i);
    }
  });

  it('has a loading skeleton and calm empty copy', () => {
    const { container } = render(
      <>
        <ActivityItemSkeleton />
        <ActivityEmpty />
      </>,
    );
    expect(container.querySelector('[data-slot="activity-skeleton"]')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(
      screen.getByText('Nothing has happened yet. Forward an order or cause list to get started.'),
    ).toBeInTheDocument();
  });
});
