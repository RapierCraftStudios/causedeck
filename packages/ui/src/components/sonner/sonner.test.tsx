// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TOASTER_LABELS, MAX_VISIBLE_TOASTS, toast, Toaster } from './sonner';

const css = readFileSync(path.join(import.meta.dirname, 'sonner.css'), 'utf8');

function region() {
  return screen.getByRole('region', { name: new RegExp(`^${DEFAULT_TOASTER_LABELS.region}`) });
}

const toasts = () => document.querySelectorAll('[data-sonner-toast]');

// jsdom lacks pointer capture, which sonner's swipe handling calls on pointerdown.
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.hasPointerCapture = () => false;
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

describe('Toaster', () => {
  it('announces toasts in a polite live region', async () => {
    render(<Toaster />);
    act(() => {
      toast('Draft saved', { duration: Infinity });
    });
    const live = region();
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(await within(live).findByText('Draft saved')).toBeInTheDocument();
  });

  it('themes toasts with token classes and a token z-index', async () => {
    render(<Toaster />);
    act(() => {
      toast('Draft saved', { duration: Infinity });
    });
    await screen.findByText('Draft saved');
    const item = toasts()[0];
    expect(item).toHaveClass(
      'bg-surface-overlay',
      'border-line',
      'text-ink',
      'rounded-lg',
      'shadow-3',
    );
    expect(item?.closest('ol')).toHaveClass('cd-toaster');
    expect(css).toMatch(/\.cd-toaster\[data-sonner-toaster\]\s*\{\s*z-index: var\(--z-toast\)/);
  });

  it('runs the action (Undo) and closes the toast', async () => {
    const onUndo = vi.fn();
    render(<Toaster />);
    act(() => {
      toast('Draft deleted', { duration: Infinity, action: { label: 'Undo', onClick: onUndo } });
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByText('Draft deleted')).toBeNull();
    });
  });

  it('dismisses from the keyboard via the labelled close button', async () => {
    render(<Toaster labels={{ close: 'மூடு' }} />);
    act(() => {
      toast('Draft saved', { duration: Infinity });
    });
    const close = await screen.findByRole('button', { name: 'மூடு' });
    close.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByText('Draft saved')).toBeNull();
    });
  });

  it(`stacks at most ${String(MAX_VISIBLE_TOASTS)} toasts`, async () => {
    render(<Toaster visibleToasts={10} />);
    act(() => {
      for (let i = 1; i <= 5; i++) toast(`Hearing ${String(i)} listed`, { duration: Infinity });
    });
    await screen.findByText('Hearing 5 listed');
    expect(toasts()).toHaveLength(5);
    expect(document.querySelectorAll('[data-sonner-toast][data-visible="true"]')).toHaveLength(
      MAX_VISIBLE_TOASTS,
    );
    // Hidden toasts leave the accessibility tree and tab order.
    expect(css).toMatch(/\[data-visible='false'\]\s*\{\s*visibility: hidden/);
  });

  it('slides 8 px and fades over --dur-base, with no transition under reduced motion', () => {
    expect(css).toMatch(/--y: translateY\(8px\)/);
    expect(css).toMatch(/--y: translateY\(-8px\)/);
    expect(css).toMatch(/transition-duration: var\(--dur-base\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\{\s*transition: none/);
  });
});
