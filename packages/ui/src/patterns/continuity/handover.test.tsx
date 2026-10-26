// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChangeCard } from './change-card';
import { HandoverView } from './handover-view';

const sections = [
  { id: 'a', title: 'Where it stands', items: [{ id: '1', text: 'For final hearing' }], emptyLabel: 'None recorded' },
  { id: 'q', title: 'Open questions', items: [], emptyLabel: 'None recorded' },
];

describe('HandoverView', () => {
  it('shows None recorded for an empty section and offers no share or export', () => {
    render(<HandoverView title="Handover" sections={sections} />);
    expect(screen.getByText('None recorded')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /share|export|email|send/i })).toBeNull();
  });

  it('acknowledges once', async () => {
    const onAcknowledge = vi.fn();
    render(
      <HandoverView
        title="Handover"
        sections={sections}
        acknowledge={{ label: 'Acknowledge', doneLabel: 'Acknowledged', done: false, onAcknowledge }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(onAcknowledge).toHaveBeenCalledOnce();
  });
});

describe('ChangeCard', () => {
  it('lists day groups and dismisses', async () => {
    const onDismiss = vi.fn();
    render(
      <ChangeCard
        heading="Since you last opened this, 12 days ago"
        groups={[{ day: '20 Oct', items: [{ id: '1', text: 'New order' }] }]}
        emptyLabel="Nothing changed"
        dismissLabel="Dismiss"
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('New order')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
