// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmBar } from './confirm-bar';
import { SourceCompare } from './source-compare';

describe('ConfirmBar', () => {
  it('confirms when nothing blocks it', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmBar confirmLabel="Confirm outcome" shortcut="Ctrl Enter" onConfirm={onConfirm} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm outcome' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('is disabled with the reason described while blocked', () => {
    render(
      <ConfirmBar
        confirmLabel="Confirm outcome"
        shortcut="Ctrl Enter"
        blockedReason="Choose the next date."
        onConfirm={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Confirm outcome' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/next date/);
  });
});

describe('SourceCompare', () => {
  it('reports the side the lawyer picks', async () => {
    const onChoose = vi.fn();
    render(
      <SourceCompare
        title="Dates differ"
        current={{ label: 'On file', value: '1 Apr', source: 'Cause list', chooseLabel: 'Keep' }}
        proposed={{ label: 'Proposed', value: '10 Apr', source: 'Order', chooseLabel: 'Use' }}
        chosen={undefined}
        onChoose={onChoose}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Use/ }));
    expect(onChoose).toHaveBeenCalledWith('proposed');
  });
});
