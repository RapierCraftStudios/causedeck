// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ANCHORS, SOURCES } from '../__fixtures__/trust';
import type { ProvenanceSource } from '../types';
import { POINTER_QUERY, ProvenanceChip } from './provenance-chip';
import { showsConfidence } from './provenance-popover';

// Radix popper measures its content; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

/** Emulate a fine hover pointer (desktop) or a touch screen. */
function device(kind: 'pointer' | 'touch'): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: kind === 'pointer' ? query === POINTER_QUERY : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ProvenanceChip', () => {
  it('renders the kind icon, short label and confirmation state', () => {
    device('pointer');
    render(<ProvenanceChip source={SOURCES.confirmed} anchor={ANCHORS.madras} />);
    const chip = screen.getByRole('button');
    expect(chip).toHaveTextContent('Order, p.2');
    expect(chip).toHaveAttribute('data-source-state', 'confirmed');
    expect(chip.querySelector('[data-icon="document"]')).not.toBeNull();
    expect(chip.querySelector('[data-state-mark="confirmed"]')).toHaveClass('bg-seal');
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    expect(chip).toHaveAccessibleName(
      'Source: Order, p.2, from Order dated 12 March 2026, page 2. Confirmed.',
    );
  });

  it.each([
    ['proposed', SOURCES.proposed],
    ['edited', SOURCES.edited],
  ] as const)('shows the %s state', (state, source) => {
    device('pointer');
    render(<ProvenanceChip source={source} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-source-state', state);
    expect(screen.getByRole('button')).toHaveAccessibleName(
      new RegExp(state === 'proposed' ? 'Proposed' : 'Edited'),
    );
  });

  it('marks a proposed source with a hollow dot and edited with a pencil', () => {
    device('pointer');
    const { container, rerender } = render(<ProvenanceChip source={SOURCES.proposed} />);
    const dot = container.querySelector('[data-state-mark="proposed"]');
    expect(dot).not.toBeNull();
    expect(dot).not.toHaveClass('bg-seal');
    rerender(<ProvenanceChip source={SOURCES.edited} />);
    expect(container.querySelector('[data-slot="provenance-pencil"]')).not.toBeNull();
  });

  it('shows the confidence dot only below 0.9 or while proposed', () => {
    device('pointer');
    const dot = (source: ProvenanceSource) => {
      const { container, unmount } = render(<ProvenanceChip source={source} />);
      const found = container.querySelector('[data-slot="provenance-confidence-dot"]') !== null;
      unmount();
      return found;
    };
    expect(dot(SOURCES.lowConfidence)).toBe(true); // 0.62
    expect(dot(SOURCES.confirmed)).toBe(false); // 0.97
    expect(dot({ ...SOURCES.confirmed, confidence: 0.9 })).toBe(false);
    expect(dot(SOURCES.proposed)).toBe(true); // 0.91 but proposed
    expect(dot({ kind: 'ai', label: 'Order', state: 'proposed' })).toBe(true);
    expect(showsConfidence(SOURCES.manual)).toBe(false);
  });

  it('marks manual facts with a pencil and "Entered by you"', () => {
    device('pointer');
    const { container } = render(<ProvenanceChip source={SOURCES.manual} />);
    expect(screen.getByRole('button')).toHaveTextContent('Entered by you');
    expect(container.querySelector('[data-slot="provenance-pencil"]')).not.toBeNull();
  });

  it('requires a source', () => {
    device('pointer');
    // @ts-expect-error a fact without a source is a type error
    const chip = <ProvenanceChip />;
    expect(chip.props).not.toHaveProperty('source');
  });

  it('opens on hover with the quote, highlight, page, title and Open source', async () => {
    device('pointer');
    const onOpenSource = vi.fn();
    render(
      <ProvenanceChip
        source={SOURCES.confirmed}
        anchor={ANCHORS.madras}
        onOpenSource={onOpenSource}
        onReportWrong={() => undefined}
      />,
    );
    const chip = screen.getByRole('button');
    fireEvent.pointerEnter(chip, { pointerType: 'mouse' });
    const card = await screen.findByRole('tooltip');
    expect(card).toHaveAttribute('data-slot', 'provenance-card');
    expect(chip).toHaveAttribute('aria-describedby', card.id);
    expect(card.contains(document.activeElement)).toBe(false);
    const quote = card.querySelector('[data-slot="provenance-quote"]');
    expect(quote).toHaveClass('font-serif', 'italic');
    expect(card.querySelector('mark')).toHaveTextContent('14.11.2026');
    expect(card).toHaveTextContent('Order dated 12 March 2026');
    expect(card).toHaveTextContent('Page 2 of 5 · Extracted by Lawyer OS · 97% confidence');
    await userEvent.click(within(card).getByRole('button', { name: 'Open source' }));
    expect(onOpenSource).toHaveBeenCalledOnce();
  });

  it('closes after the pointer leaves, unless it moves into the card', () => {
    device('pointer');
    vi.useFakeTimers();
    render(<ProvenanceChip source={SOURCES.confirmed} anchor={ANCHORS.madras} />);
    const chip = screen.getByRole('button');
    fireEvent.pointerEnter(chip, { pointerType: 'mouse' });
    const card = screen.getByRole('tooltip');
    fireEvent.pointerLeave(chip, { pointerType: 'mouse' });
    fireEvent.pointerEnter(card, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerLeave(card, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on focus as a preview and keeps focus on the chip', async () => {
    device('pointer');
    render(<ProvenanceChip source={SOURCES.confirmed} anchor={ANCHORS.madras} />);
    await userEvent.tab();
    const chip = screen.getByRole('button');
    expect(chip).toHaveFocus();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it.each(['{Enter}', ' '])(
    'opens with %s as a dialog, Esc closes and returns focus',
    async (key) => {
      device('pointer');
      render(
        <ProvenanceChip
          source={SOURCES.confirmed}
          anchor={ANCHORS.madras}
          onOpenSource={() => undefined}
        />,
      );
      await userEvent.tab();
      const chip = screen.getByRole('button', { name: /^Source:/ });
      await userEvent.keyboard(key);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('data-slot', 'provenance-card');
      expect(within(dialog).getByRole('button', { name: 'Open source' })).toHaveFocus();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('tooltip')).toBeNull();
      expect(chip).toHaveFocus();
    },
  );

  it('uses a bottom sheet dialog on touch and never opens on hover', async () => {
    device('touch');
    render(
      <ProvenanceChip
        source={SOURCES.confirmed}
        anchor={ANCHORS.madras}
        onOpenSource={() => undefined}
      />,
    );
    const chip = screen.getByRole('button');
    fireEvent.pointerEnter(chip, { pointerType: 'mouse' });
    fireEvent.pointerEnter(chip, { pointerType: 'touch' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.click(chip);
    const sheet = screen.getByRole('dialog', { name: 'Order dated 12 March 2026' });
    expect(sheet).toHaveAttribute('data-slot', 'provenance-sheet');
    expect(sheet).toHaveTextContent('Page 2 of 5');
  });

  it('disables actions offline with the reason and hides them when view only', () => {
    device('pointer');
    const { rerender } = render(
      <ProvenanceChip
        source={SOURCES.confirmed}
        anchor={ANCHORS.madras}
        onOpenSource={() => undefined}
        offline
        open
      />,
    );
    const open = screen.getByRole('button', { name: 'Open source' });
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute('title', 'You are offline. Reconnect to open the source.');
    rerender(
      <ProvenanceChip
        source={SOURCES.confirmed}
        anchor={ANCHORS.madras}
        onOpenSource={() => undefined}
        viewOnly
        open
      />,
    );
    expect(screen.queryByRole('button', { name: 'Open source' })).toBeNull();
    expect(screen.getByText(/View only/)).toBeInTheDocument();
  });

  it('opens with a 150 ms fade and 4 px rise, instant under reduced motion', () => {
    device('pointer');
    render(<ProvenanceChip source={SOURCES.confirmed} anchor={ANCHORS.madras} open />);
    const card = document.querySelector('[data-slot="provenance-card"]');
    expect(card).toHaveAttribute('data-side', 'top');
    for (const cls of [
      'data-[state=open]:fade-in-0',
      'data-[state=open]:duration-(--dur-fast)',
      'data-[side=top]:slide-in-from-bottom-1',
    ]) {
      expect(card?.className).toContain(cls);
    }
    const css = readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'tokens', 'motion.css'),
      'utf8',
    );
    expect(css).toMatch(/--dur-fast:\s*150ms/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/--dur-fast:\s*0\.01ms/);
    expect(reduced).toMatch(/--motion-transform:\s*none/);
  });

  it('offers no send, file or pay action', () => {
    device('pointer');
    render(
      <ProvenanceChip
        source={SOURCES.confirmed}
        anchor={ANCHORS.madras}
        onOpenSource={() => undefined}
        onReportWrong={() => undefined}
        open
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent).not.toMatch(/\b(send|file|pay)\b/i);
    }
  });
});
