// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AttentionList, groupByRule, type AttentionFlagView } from './attention-list';

const FLAGS: AttentionFlagView[] = [
  {
    key: 'a',
    matterTitle: 'Asha v. State',
    rule: 'no_next_date',
    evidence: 'No next date since 2026-11-01',
    since: '2026-11-01',
    suggestedAction: 'Set the next date',
  },
  {
    key: 'b',
    matterTitle: 'Ravi v. State',
    rule: 'no_next_date',
    evidence: 'No next date since 2026-10-01',
    since: '2026-10-01',
    suggestedAction: 'Set the next date',
  },
  {
    key: 'c',
    matterTitle: 'Mala v. State',
    rule: 'no_recent_update',
    evidence: 'No update in 40 days',
    since: '2026-10-01',
    suggestedAction: 'Ask the junior for an update',
  },
];

describe('AttentionList', () => {
  it('groups by rule', () => {
    expect(groupByRule(FLAGS).map(([rule, items]) => [rule, items.length])).toEqual([
      ['no_next_date', 2],
      ['no_recent_update', 1],
    ]);
  });

  it.each([
    ['empty', 'Nothing needs you right now.'],
    ['error', 'Could not load what needs you. Try again.'],
    ['denied', 'You do not have access to these flags in this workspace.'],
  ] as const)('renders the %s state', (state, text) => {
    render(<AttentionList state={state} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('renders loading and offline', () => {
    const { unmount } = render(<AttentionList state="loading" />);
    expect(screen.getByText('Loading what needs you')).toBeTruthy();
    unmount();
    render(<AttentionList state="offline" flags={FLAGS} />);
    expect(screen.getByText('You are offline. Showing the last loaded flags.')).toBeTruthy();
  });

  it('s snoozes, Enter opens and Esc closes from the keyboard', async () => {
    const onSnooze = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<AttentionList flags={FLAGS} onSnooze={onSnooze} onOpen={onOpen} onClose={onClose} />);
    const user = userEvent.setup();
    const [first] = screen.getAllByRole('listitem');
    first?.focus();
    await user.keyboard('s');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(onSnooze).toHaveBeenCalledWith('a');
    expect(onOpen).toHaveBeenCalledWith('a');
    expect(onClose).toHaveBeenCalled();
  });

  it('hides snooze for a viewer and shows the suggestion as text when open', () => {
    render(<AttentionList flags={FLAGS} readOnly openKey="a" />);
    expect(screen.queryByRole('button', { name: 'Snooze' })).toBeNull();
    expect(screen.getAllByText('Set the next date').length).toBeGreaterThan(0);
  });
});
