// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SnoozeHistory } from './snooze-history';

const base = { title: 'Snoozes', empty: 'None.', liftLabel: 'Lift' };
const items = [
  {
    id: 's1',
    ruleLabel: 'No next date',
    statusText: 'Snoozed until 2026-11-20',
    reasonText: 'Reason: x',
  },
  { id: 's2', ruleLabel: 'All flags', statusText: 'Dismissed' },
];

describe('SnoozeHistory', () => {
  it('shows the empty state', () => {
    render(<SnoozeHistory {...base} items={[]} />);
    expect(screen.getByText('None.')).toBeTruthy();
  });

  it('lists snoozes and dismissals and lifts one', async () => {
    const onLift = vi.fn();
    render(<SnoozeHistory {...base} items={items} onLift={onLift} />);
    expect(screen.getByText('Snoozed until 2026-11-20')).toBeTruthy();
    expect(screen.getByText('Reason: x')).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'Lift' })[0] as HTMLElement);
    expect(onLift).toHaveBeenCalledWith('s1');
  });

  it('has no lift control without onLift', () => {
    render(<SnoozeHistory {...base} items={items} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
