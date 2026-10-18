// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NOW } from '../__fixtures__/trust';
import * as patterns from '../index';
import { PATTERN_EMPTY_COPY, PatternEmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { PatternSkeleton, SKELETON_PATTERNS } from './loading-skeletons';
import { NOT_FOUND_COPY, NotFound } from './not-found';
import { formatSavedTime, OfflineBanner } from './offline-banner';
import { PERMISSION_DENIED_COPY, PermissionDenied } from './permission-denied';

describe('PatternEmptyState', () => {
  it('uses the spec copy: one calm sentence, no exclamation', () => {
    expect(PATTERN_EMPTY_COPY).toEqual({
      proposals: 'Nothing needs you right now.',
      activity: 'Nothing has happened yet. Forward an order or cause list to get started.',
      obligations: 'No open obligations. Well kept.',
    });
    for (const copy of Object.values(PATTERN_EMPTY_COPY)) expect(copy).not.toMatch(/!/);
  });

  it('offers exactly one primary action', async () => {
    const onAction = vi.fn();
    const { container } = render(
      <PatternEmptyState kind="activity" actionLabel="Forward an order" onAction={onAction} />,
    );
    expect(screen.getByText(PATTERN_EMPTY_COPY.activity)).toBeInTheDocument();
    const buttons = within(container).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('data-variant', 'primary');
    await userEvent.click(buttons[0] as HTMLElement);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('shows no action without a callback', () => {
    render(<PatternEmptyState kind="proposals" actionLabel="Review" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ErrorState', () => {
  it('says what happened, offers Try again and links to support', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Could not load the cause list."
        description="Your saved list is still here."
        onRetry={onRetry}
        supportHref="mailto:support@example.com"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Could not load the cause list.')).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'Contact support' })).toHaveAttribute(
      'href',
      'mailto:support@example.com',
    );
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('OfflineBanner', () => {
  it('reads `You are offline. Showing saved data from <time>.`', () => {
    render(<OfflineBanner savedAt={NOW} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(
      `You are offline. Showing saved data from ${formatSavedTime(NOW)}.`,
    );
    expect(status.querySelector('time')).toHaveAttribute('dateTime', NOW.toISOString());
  });

  it('formats the time in IST by default and accepts a formatter', () => {
    expect(formatSavedTime(NOW)).toMatch(/^10:00\s?am$/i);
    render(<OfflineBanner savedAt={NOW} formatTime={() => '9:41 am'} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'You are offline. Showing saved data from 9:41 am.',
    );
  });
});

describe('PermissionDenied', () => {
  it('shows a lock and who to ask, with no actions', () => {
    const { container } = render(<PermissionDenied />);
    expect(PERMISSION_DENIED_COPY).toBe('You do not have access to this. Ask the workspace owner.');
    expect(screen.getByText(PERMISSION_DENIED_COPY)).toBeInTheDocument();
    expect(container.querySelector('[data-slot="permission-denied-lock"]')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('NotFound', () => {
  it('is one calm sentence with one way back', async () => {
    const onAction = vi.fn();
    render(<NotFound actionLabel="Back to matters" onAction={onAction} />);
    expect(screen.getByText(NOT_FOUND_COPY)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to matters' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});

describe('PatternSkeleton', () => {
  it.each(SKELETON_PATTERNS)('%s is one busy status announced as Loading', (pattern) => {
    const { container } = render(<PatternSkeleton pattern={pattern} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('data-pattern', pattern);
    expect(status).toHaveTextContent(/^Loading$/);
    expect(container.querySelectorAll('.cd-skeleton').length).toBeGreaterThan(0);
  });

  it('repeats list rows', () => {
    const { container } = render(<PatternSkeleton pattern="obligation-row" rows={3} />);
    expect(container.querySelectorAll('[role="status"] > div')).toHaveLength(3);
  });
});

describe('patterns barrel', () => {
  it('exports the state screens', () => {
    for (const name of [
      'PatternEmptyState',
      'PatternSkeleton',
      'ErrorState',
      'OfflineBanner',
      'PermissionDenied',
      'NotFound',
    ]) {
      expect(patterns).toHaveProperty(name);
    }
  });
});
