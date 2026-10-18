// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NOW, OBLIGATIONS } from '../__fixtures__/trust';
import {
  ObligationEmpty,
  ObligationRow,
  ObligationRowSkeleton,
  SWIPE_THRESHOLD_PX,
  daysUntil,
  dueState,
} from './obligation-row';

// Radix popper measures its content; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

const surface = (container: HTMLElement) => {
  const el = container.querySelector('[data-slot="obligation-surface"]');
  if (!(el instanceof HTMLElement)) throw new Error('no surface');
  return el;
};

/** Drag the row horizontally by `dx` px with a touch pointer. */
function swipe(el: HTMLElement, dx: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, pointerType: 'touch' });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, pointerType: 'touch' });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, pointerType: 'touch' });
}

describe('due dates', () => {
  it('counts calendar days in IST', () => {
    expect(daysUntil('2026-10-15', NOW)).toBe(-3);
    expect(daysUntil('2026-10-18', NOW)).toBe(0);
    // 23:30 UTC on 17 Oct is already 18 Oct in India.
    expect(daysUntil('2026-10-18', new Date('2026-10-17T23:30:00Z'))).toBe(0);
    expect(dueState('2026-10-15', NOW)).toBe('overdue');
    expect(dueState('2026-10-18', NOW)).toBe('due-today');
    expect(dueState('2026-11-14', NOW)).toBe('upcoming');
  });
});

describe('ObligationRow', () => {
  it('shows the due date in tabular numerals with its state and the owner avatar', () => {
    const { container } = render(<ObligationRow {...OBLIGATIONS.upcoming} now={NOW} />);
    const date = container.querySelector('[data-slot="obligation-date"]');
    expect(date).toHaveClass('tabular-nums');
    expect(date).toHaveTextContent('14 Nov 2026');
    expect(date).toHaveAttribute('dateTime', '2026-11-14');
    expect(screen.getByText('Due in 27 days')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Meenakshi Sundaram' })).toHaveTextContent('MS');
  });

  it('marks overdue with danger-soft background, an icon and text', () => {
    const { container } = render(<ObligationRow {...OBLIGATIONS.overdue} now={NOW} />);
    expect(container.querySelector('[data-slot="obligation-row"]')).toHaveAttribute(
      'data-due-state',
      'overdue',
    );
    expect(surface(container)).toHaveClass('bg-danger-soft');
    expect(container.querySelector('[data-slot="obligation-overdue-icon"]')).not.toBeNull();
    expect(screen.getByText('Overdue by 3 days')).toBeInTheDocument();
  });

  it('says `Due today` for today', () => {
    render(<ObligationRow {...OBLIGATIONS.today} now={NOW} />);
    expect(screen.getByText('Due today')).toBeInTheDocument();
  });

  it('on touch, swipe left marks done and swipe right snoozes', () => {
    const onDone = vi.fn();
    const onSnooze = vi.fn();
    const { container } = render(
      <ObligationRow
        {...OBLIGATIONS.today}
        now={NOW}
        presentation="touch"
        onDone={onDone}
        onSnooze={onSnooze}
      />,
    );
    expect(container.querySelector('[data-slot="obligation-swipe-done"]')).toHaveTextContent(
      'Done',
    );
    expect(container.querySelector('[data-slot="obligation-swipe-snooze"]')).toHaveTextContent(
      'Snooze',
    );
    swipe(surface(container), -(SWIPE_THRESHOLD_PX + 10));
    expect(onDone).toHaveBeenCalledOnce();
    expect(onSnooze).not.toHaveBeenCalled();
    swipe(surface(container), SWIPE_THRESHOLD_PX + 10);
    expect(onSnooze).toHaveBeenCalledOnce();
    // A short drag is not a swipe.
    swipe(surface(container), -(SWIPE_THRESHOLD_PX - 20));
    expect(onDone).toHaveBeenCalledOnce();
    expect(surface(container).style.transform).toBe('');
  });

  it('does not swipe on a fine pointer', () => {
    const onDone = vi.fn();
    const { container } = render(
      <ObligationRow {...OBLIGATIONS.today} now={NOW} presentation="pointer" onDone={onDone} />,
    );
    expect(container.querySelector('[data-slot="obligation-swipe-done"]')).toBeNull();
    swipe(surface(container), -200);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('offers Done and Snooze in the overflow menu by keyboard', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onSnooze = vi.fn();
    render(
      <ObligationRow
        {...OBLIGATIONS.today}
        now={NOW}
        presentation="touch"
        onDone={onDone}
        onSnooze={onSnooze}
      />,
    );
    const more = screen.getByRole('button', {
      name: 'More actions for Comply with office objections',
    });
    // 44 px on touch, through the button scale.
    expect(more).toHaveClass('pointer-coarse:hit');
    more.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Mark done' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onDone).toHaveBeenCalledOnce();

    more.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: 'Snooze' });
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Snooze' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSnooze).toHaveBeenCalledOnce();
  });

  it('keeps the row at least 44 px tall', () => {
    const { container } = render(<ObligationRow {...OBLIGATIONS.today} now={NOW} />);
    expect(surface(container)).toHaveClass('min-h-11');
  });

  it('disables actions offline and hides them for view-only viewers', () => {
    const onDone = vi.fn();
    const { container, rerender } = render(
      <ObligationRow
        {...OBLIGATIONS.today}
        now={NOW}
        presentation="touch"
        offline
        onDone={onDone}
      />,
    );
    expect(screen.getByRole('button', { name: /More actions/ })).toBeDisabled();
    expect(screen.getByText(/You are offline/)).toBeInTheDocument();
    swipe(surface(container), -200);
    expect(onDone).not.toHaveBeenCalled();
    rerender(<ObligationRow {...OBLIGATIONS.today} now={NOW} viewOnly onDone={onDone} />);
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(screen.getByText('View only')).toBeInTheDocument();
  });

  it('has a loading skeleton and calm empty copy', () => {
    const { container } = render(
      <>
        <ObligationRowSkeleton />
        <ObligationEmpty />
      </>,
    );
    expect(container.querySelector('[data-slot="obligation-skeleton"]')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByText('No open obligations. Well kept.')).toBeInTheDocument();
  });
});
