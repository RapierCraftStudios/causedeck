// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockMatchMedia, nextFrame, renderWithIntl, stubResizeObserver } from './helpers.tsx';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/w/demo/today',
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const { CaptureFab, CaptureProvider, useCapture } = await import('../capture-fab.tsx');
const { loadShellOverlays } = await import('../use-shell-overlays.ts');

/** Calls the capture API the way the `c` shortcut (#157) will. */
function ShortcutProbe() {
  const { openCapture } = useCapture();
  return <button type="button" hidden data-probe="capture" onClick={openCapture} />;
}

const trigger = () => screen.getByRole('button', { name: 'Capture' });
const actions = (sheet: HTMLElement) =>
  [...sheet.querySelectorAll<HTMLElement>('[data-capture-action]')].map((a) => a.textContent);

beforeEach(async () => {
  mockMatchMedia();
  stubResizeObserver();
  await loadShellOverlays();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('capture button', () => {
  it('is a labelled 52 px button that opens a dialog', () => {
    renderWithIntl(<CaptureFab />);
    const button = trigger();
    expect(button.textContent).toBe('Capture');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.querySelector('[data-capture-circle]')?.className).toMatch(/\bsize-\[52px\]/);
    expect(button.className).toMatch(/\bmin-h-11\b/);
  });

  it('keeps the label clear of the circle in the 56 px slot (#183)', () => {
    renderWithIntl(<CaptureFab />);
    const button = trigger();
    // 56 px slot (h-14). Circle: 52 px from -16 px, so it ends at 36 px. Label: 12 px line above a
    // 2 px bottom padding, so it starts at 42 px. jsdom has no layout, so check the classes.
    expect(button.className).toMatch(/\bh-14\b/);
    expect(button.className).toMatch(/\bpb-0\.5\b/);
    expect(button.querySelector('[data-capture-circle]')?.className).toMatch(/(^|\s)-top-4\b/);
    expect(button.querySelector('[data-capture-label]')?.className).toMatch(/\bleading-3\b/);
  });

  it('opens a bottom sheet with Voice note, Photo or file and Paste text as stubs', () => {
    renderWithIntl(<CaptureFab />);
    const button = trigger();
    fireEvent.click(button);
    const sheet = screen.getByRole('dialog', { name: 'Capture' });
    expect(sheet.getAttribute('data-side')).toBe('bottom');
    expect(actions(sheet)).toEqual(['Voice note', 'Photo or file', 'Paste text']);
    for (const action of sheet.querySelectorAll<HTMLElement>('[data-capture-action]')) {
      // Voice note (#543) is live; the other two stay stubs.
      expect(action.hasAttribute('disabled')).toBe(action.dataset['captureAction'] !== 'voice');
      expect(action.className).toMatch(/\bmin-h-11\b/);
    }
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the voice recorder from the Voice note action', () => {
    push.mockClear();
    renderWithIntl(<CaptureFab />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Voice note' }));
    expect(push).toHaveBeenCalledWith('/w/demo/today?capture=voice');
  });

  it('opens from useCapture().openCapture() inside the provider', () => {
    renderWithIntl(
      <CaptureProvider>
        <ShortcutProbe />
        <CaptureFab />
      </CaptureProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(document.querySelector('[data-probe="capture"]') as HTMLElement);
    expect(actions(screen.getByRole('dialog', { name: 'Capture' }))).toHaveLength(3);
  });

  it('closes on Esc and returns focus to the button', async () => {
    renderWithIntl(<CaptureFab />);
    const button = trigger();
    button.focus();
    fireEvent.click(button);
    const sheet = screen.getByRole('dialog', { name: 'Capture' });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(nextFrame);
    expect(document.activeElement).toBe(button);
  });

  it('has a harmless default outside the provider', () => {
    function Outside() {
      const api = useCapture();
      api.openCapture();
      return <output data-open={String(api.open)} />;
    }
    renderWithIntl(<Outside />);
    expect(document.querySelector('output')?.dataset.open).toBe('false');
  });
});
