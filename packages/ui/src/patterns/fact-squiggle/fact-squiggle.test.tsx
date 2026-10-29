// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POINTER_QUERY } from '../provenance-chip/provenance-chip';
import {
  FACT_STATUS_META,
  FACT_STATUS_ORDER,
  FactLiveRegion,
  FactSquiggle,
  type FactStatus,
} from './fact-squiggle';
import { nextIssueIndex, useFactNavigation } from './use-fact-navigation';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

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
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

const SOURCE = {
  document: 'Order.pdf',
  page: 3,
  quote: 'Listed on 12 March 2024.',
  highlight: { start: 10, end: 23 },
};

describe('FactSquiggle underline', () => {
  it('uses a 1.5px wavy underline in the verdict token', () => {
    const expected: Partial<Record<FactStatus, string>> = {
      mismatch: 'decoration-danger',
      ambiguous: 'decoration-warning',
      'unverified-citation': 'decoration-warning',
    };
    for (const [status, token] of Object.entries(expected)) {
      const meta = FACT_STATUS_META[status as FactStatus];
      expect(meta.classes).toContain('decoration-[1.5px]');
      expect(meta.classes).toContain('decoration-wavy');
      expect(meta.classes).toContain(token);
    }
  });

  it('is dotted and muted for unsupported, and has no underline for a match', () => {
    expect(FACT_STATUS_META.unsupported.classes).toContain('decoration-dotted');
    expect(FACT_STATUS_META.unsupported.classes).toContain('decoration-ink-muted');
    expect(FACT_STATUS_META.unsupported.classes).not.toContain('wavy');
    expect(FACT_STATUS_META.match.classes).toContain('no-underline');
    expect(FACT_STATUS_ORDER).toHaveLength(5);
  });

  it('marks the rendered claim with its status', () => {
    device('pointer');
    render(<FactSquiggle status="mismatch">12 March 2024</FactSquiggle>);
    expect(screen.getByRole('button', { name: /12 March 2024/ })).toHaveAttribute(
      'data-status',
      'mismatch',
    );
  });
});

describe('FactSquiggle card', () => {
  it('shows icon text, the quote with highlight, the page link and fires every action', async () => {
    device('pointer');
    const user = userEvent.setup();
    const handlers = {
      onFix: vi.fn(),
      onIgnore: vi.fn(),
      onIgnoreForMatter: vi.fn(),
      onMarkAssertion: vi.fn(),
      onOpenPage: vi.fn(),
    };
    for (const [name, label] of [
      ['onFix', 'Fix'],
      ['onIgnore', 'Ignore'],
      ['onIgnoreForMatter', 'Ignore for this matter'],
      ['onMarkAssertion', 'Mark as my assertion'],
    ] as const) {
      const { unmount } = render(
        <FactSquiggle status="mismatch" source={SOURCE} defaultOpen {...handlers}>
          12 March 2024
        </FactSquiggle>,
      );
      expect(screen.getByText('Does not match the record')).toBeInTheDocument();
      expect(document.querySelector('mark')?.textContent).toBe('12 March 2024');
      await user.click(screen.getByRole('button', { name: label }));
      expect(handlers[name]).toHaveBeenCalledTimes(1);
      unmount();
    }
    render(
      <FactSquiggle status="mismatch" source={SOURCE} defaultOpen {...handlers}>
        x
      </FactSquiggle>,
    );
    await user.click(screen.getByRole('button', { name: 'Open page 3' }));
    expect(handlers.onOpenPage).toHaveBeenCalledWith(3);
  });

  it('fades and scales over the 150 ms token and is instant under reduced motion', () => {
    device('pointer');
    render(
      <FactSquiggle status="unsupported" source={SOURCE} defaultOpen>
        x
      </FactSquiggle>,
    );
    const card = document.querySelector('[data-slot="popover-content"]');
    expect(card?.className).toContain('duration-(--dur-fast)');
    expect(card?.className).toContain('zoom-in-95');
    expect(card?.className).toContain('motion-reduce:animate-none');
  });

  it('opens a bottom sheet on touch', () => {
    device('touch');
    render(
      <FactSquiggle status="ambiguous" source={SOURCE} defaultOpen>
        x
      </FactSquiggle>,
    );
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  });

  it('opens with Enter on the focused squiggle', async () => {
    device('pointer');
    const user = userEvent.setup();
    render(
      <FactSquiggle status="mismatch" source={SOURCE}>
        x
      </FactSquiggle>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Does not match the record')).toBeInTheDocument();
  });
});

function Doc() {
  const ref = useRef<HTMLDivElement>(null);
  const message = useFactNavigation(ref);
  return (
    <div ref={ref} tabIndex={-1} data-testid="doc">
      <FactSquiggle status="mismatch">one</FactSquiggle>
      <FactSquiggle status="match">fine</FactSquiggle>
      <FactSquiggle status="unsupported">two</FactSquiggle>
      <FactLiveRegion message={message} />
    </div>
  );
}

describe('keyboard navigation', () => {
  it('wraps through issues and skips matches', () => {
    expect(nextIssueIndex(-1, 3, false)).toBe(0);
    expect(nextIssueIndex(-1, 3, true)).toBe(2);
    expect(nextIssueIndex(2, 3, false)).toBe(0);
    expect(nextIssueIndex(0, 3, true)).toBe(2);
    expect(nextIssueIndex(-1, 0, false)).toBe(-1);
  });

  it('F8 / Shift+F8 move focus and announce the issue', () => {
    device('pointer');
    render(<Doc />);
    const doc = screen.getByTestId('doc');
    fireEvent.keyDown(doc, { key: 'F8' });
    expect(screen.getByRole('button', { name: /one/ })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Issue 1 of 2: Does not match the record');
    fireEvent.keyDown(document.activeElement ?? doc, { key: 'F8' });
    expect(screen.getByRole('button', { name: /two/ })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Issue 2 of 2: Not found in the record');
    fireEvent.keyDown(document.activeElement ?? doc, { key: 'F8', shiftKey: true });
    expect(screen.getByRole('button', { name: /one/ })).toHaveFocus();
  });
});
