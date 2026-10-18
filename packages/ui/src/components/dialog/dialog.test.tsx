// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DIALOG_LABELS,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  dialogContentClasses,
} from './dialog';

function Example(props: { labels?: { close: string }; layout?: 'auto' | 'dialog' | 'sheet' }) {
  return (
    <Dialog>
      <DialogTrigger>Reschedule</DialogTrigger>
      <DialogContent {...props}>
        <DialogTitle>Reschedule hearing</DialogTitle>
        <DialogDescription>Pick the next date.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('opens a titled, described modal with an English close label', async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    const dialog = screen.getByRole('dialog', { name: 'Reschedule hearing' });
    expect(dialog).toHaveAccessibleDescription('Pick the next date.');
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content');
    expect(screen.getByRole('button', { name: DEFAULT_DIALOG_LABELS.close })).toBeInTheDocument();
    expect(DEFAULT_DIALOG_LABELS).toEqual({ close: 'Close' });
  });

  it('routes the close label through `labels`', async () => {
    render(<Example labels={{ close: 'மூடு' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    expect(screen.getByRole('button', { name: 'மூடு' })).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Reschedule' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('centres on wide screens (no matchMedia match) and can be forced to a bottom sheet', async () => {
    const { unmount } = render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-layout', 'dialog');
    unmount();
    render(<Example layout="sheet" />);
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveAttribute('data-layout', 'sheet');
    expect(sheet.className).toContain('rounded-t-xl');
    expect(sheet.querySelector('[data-slot="sheet-handle"]')).not.toBeNull();
  });

  it('animates 200 ms scale 0.98 plus fade in, 100 ms out, with token classes only', () => {
    expect(dialogContentClasses).toContain('zoom-in-98');
    expect(dialogContentClasses).toContain('data-[state=open]:duration-(--dur-base)');
    expect(dialogContentClasses).toContain('data-[state=closed]:duration-(--dur-exit)');
    expect(dialogContentClasses).toContain('bg-surface-overlay');
    expect(dialogContentClasses).toContain('z-modal');
  });
});
