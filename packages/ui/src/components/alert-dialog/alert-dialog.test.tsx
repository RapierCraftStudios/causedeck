// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';

function Example({ onConfirm }: { onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>Archive matter</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Archive this matter?</AlertDialogTitle>
        <AlertDialogDescription>You can restore it later.</AlertDialogDescription>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={onConfirm}>
          Archive
        </AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  );
}

describe('AlertDialog', () => {
  it('opens an alertdialog with title and description and no close button', async () => {
    render(<Example onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive matter' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Archive this matter?' });
    expect(dialog).toHaveAccessibleDescription('You can restore it later.');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(dialog.className).toContain('z-modal');
  });

  it('styles actions with the button variants', async () => {
    render(<Example onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive matter' }));
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('bg-surface-sunken');
  });

  it('confirms with the action and cancels with Escape', async () => {
    const onConfirm = vi.fn();
    render(<Example onConfirm={onConfirm} />);
    const trigger = screen.getByRole('button', { name: 'Archive matter' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
