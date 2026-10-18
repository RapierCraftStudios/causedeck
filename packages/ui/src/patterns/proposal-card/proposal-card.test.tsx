// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { motion as tokens } from '../../../tokens/tokens';
import { REDUCED_MOTION_QUERY } from '../../hooks/use-reduced-motion';
import { ANCHORS, PROPOSALS } from '../__fixtures__/trust';
import type { Proposal } from '../types';
import {
  CHECK_TRANSITION,
  COLLAPSE_TRANSITION,
  CONFIRM_CHECK_MS,
  EASE_STANDARD,
  INSTANT_TRANSITION,
  ProposalCard,
} from './proposal-card';
import { ProposalCardGroup } from './proposal-card-group';
import { PROPOSAL_SHORTCUTS, proposalShortcut } from './use-proposal-shortcuts';

// Radix popper measures its content; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

function reducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === REDUCED_MOTION_QUERY,
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

const [hearing, objections, affidavit] = PROPOSALS as [
  Proposal<string>,
  Proposal<string>,
  Proposal<string>,
];

const cardOf = (title: string): HTMLElement => screen.getByRole('group', { name: title });

describe('ProposalCard', () => {
  it('shows the title, the before/after diff, provenance, confidence and level', () => {
    render(<ProposalCard proposal={hearing} anchor={ANCHORS.madras} />);
    const card = cardOf('Next hearing');
    expect(within(card).getByRole('heading', { name: 'Next hearing' })).toHaveClass('font-serif');
    const before = card.querySelector('[data-slot="proposal-before"]');
    expect(before?.tagName).toBe('DEL');
    expect(before).toHaveClass('line-through', 'text-ink-subtle');
    expect(before).toHaveTextContent('7 Nov 2026');
    const after = card.querySelector('[data-slot="proposal-after"]');
    expect(after?.tagName).toBe('INS');
    expect(after).toHaveClass('bg-accent-soft', 'text-ink', 'font-medium');
    expect(after).toHaveTextContent('14 Nov 2026');
    expect(within(card).getByRole('button', { name: /^Source:/ })).toBeInTheDocument();
    expect(card.querySelector('[data-slot="proposal-confidence"]')).toHaveTextContent(
      '97% confidence',
    );
    expect(card.querySelector('[data-slot="level-badge"]')).toHaveAttribute('data-level', 'L2');
  });

  it('omits the old value when there is none', () => {
    render(<ProposalCard proposal={objections} />);
    const card = cardOf('Comply with office objections');
    expect(card.querySelector('del')).toBeNull();
    expect(card.querySelector('ins')).toHaveTextContent('By 17 Apr 2026');
  });

  it('marks a proposed source with the L2 amber edge', () => {
    render(<ProposalCard proposal={objections} />);
    expect(cardOf('Comply with office objections')).toHaveClass('border-l-level-l2', 'border-l-3');
  });

  it('announces each action shortcut', () => {
    render(<ProposalCard proposal={hearing} />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Enter',
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-keyshortcuts', 'E');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Backspace X',
    );
    expect(PROPOSAL_SHORTCUTS.next.aria).toBe('J');
    expect(PROPOSAL_SHORTCUTS.previous.aria).toBe('K');
  });

  it('offers no send, file or pay action and no fifth level', () => {
    const { container } = render(<ProposalCard proposal={hearing} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent).not.toMatch(/\b(send|file|pay)\b/i);
    }
    expect(container.textContent).not.toMatch(/L5|level 5/i);
  });

  it('disables actions with the reason offline and hides them when view-only', () => {
    const { rerender } = render(<ProposalCard proposal={hearing} offline />);
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('title', expect.stringMatching(/offline/i));
    rerender(<ProposalCard proposal={hearing} viewOnly />);
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.getByText(/View only/)).toBeInTheDocument();
  });

  it('restores the card with an inline error and focus when confirming fails', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('network')));
    const onConfirmed = vi.fn();
    render(<ProposalCard proposal={hearing} onConfirm={onConfirm} onConfirmed={onConfirmed} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not confirm this change');
    const card = cardOf('Next hearing');
    expect(card).toHaveAttribute('data-phase', 'idle');
    await waitFor(() => {
      expect(card).toHaveFocus();
    });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});

describe('ProposalCard motion', () => {
  it('draws the check in 200 ms --ease-standard and collapses on the {420, 34} spring', () => {
    expect(CONFIRM_CHECK_MS).toBe(200);
    expect(EASE_STANDARD).toEqual([...tokens.easingPoints.standard]);
    expect(CHECK_TRANSITION).toEqual({ duration: 0.2, ease: EASE_STANDARD });
    expect(COLLAPSE_TRANSITION).toMatchObject({ type: 'spring', stiffness: 420, damping: 34 });
    expect(COLLAPSE_TRANSITION).toMatchObject({ opacity: { duration: 0.2, ease: EASE_STANDARD } });
    expect(INSTANT_TRANSITION).toEqual({ duration: 0 });
  });

  it('resolves optimistically: the check holds for 200 ms, then the card collapses', async () => {
    reducedMotion(false);
    vi.useFakeTimers();
    const onConfirmed = vi.fn();
    render(
      <ProposalCard
        proposal={hearing}
        onConfirm={() => new Promise<void>(() => undefined)}
        onConfirmed={onConfirmed}
      />,
    );
    const card = cardOf('Next hearing');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(card).toHaveAttribute('data-phase', 'checking');
    expect(card.querySelector('[data-slot="proposal-check"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRM_CHECK_MS - 1);
    });
    expect(card).toHaveAttribute('data-phase', 'checking');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    // Collapsed while the save is still pending: optimistic.
    expect(card).toHaveAttribute('data-phase', 'collapsed');
    expect(card.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('is instant under prefers-reduced-motion', async () => {
    reducedMotion(true);
    vi.useFakeTimers();
    render(<ProposalCard proposal={hearing} onConfirm={() => undefined} />);
    const card = cardOf('Next hearing');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(card).toHaveAttribute('data-phase', 'collapsed');
  });
});

describe('proposalShortcut', () => {
  const card = document.createElement('div');
  const button = document.createElement('button');
  card.append(button);
  const key = (k: string, target: unknown, extra: Partial<KeyboardEvent> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target,
    ...extra,
  });

  it('maps J/K, Enter, E and Backspace/X', () => {
    expect(proposalShortcut(key('j', card), card)).toBe('next');
    expect(proposalShortcut(key('K', card), card)).toBe('previous');
    expect(proposalShortcut(key('Enter', card), card)).toBe('confirm');
    expect(proposalShortcut(key('e', button), card)).toBe('edit');
    expect(proposalShortcut(key('Backspace', card), card)).toBe('dismiss');
    expect(proposalShortcut(key('x', card), card)).toBe('dismiss');
  });

  it('leaves Enter on a button, modified keys and typing alone', () => {
    expect(proposalShortcut(key('Enter', button), card)).toBeNull();
    expect(proposalShortcut(key('e', card, { metaKey: true }), card)).toBeNull();
    const input = document.createElement('input');
    expect(proposalShortcut(key('x', input), card)).toBeNull();
    expect(proposalShortcut(key('e', document.body), null)).toBeNull();
  });
});

describe('ProposalCardGroup', () => {
  it('is a list of cards with a roving tabindex and a "need you" header', () => {
    render(<ProposalCardGroup proposals={PROPOSALS} />);
    const list = screen.getByRole('list', { name: '3 need you' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(cardOf('Next hearing')).toHaveAttribute('tabindex', '0');
    expect(cardOf('Comply with office objections')).toHaveAttribute('tabindex', '-1');
  });

  it('runs shortcuts only while the group has focus', async () => {
    const onEdit = vi.fn();
    const onDismiss = vi.fn();
    const onConfirm = vi.fn(() => new Promise<void>(() => undefined));
    render(
      <>
        <button type="button">Outside</button>
        <ProposalCardGroup
          proposals={PROPOSALS}
          onEdit={onEdit}
          onDismiss={onDismiss}
          onConfirm={onConfirm}
        />
      </>,
    );
    screen.getByRole('button', { name: 'Outside' }).focus();
    await userEvent.keyboard('jex{Backspace}{Enter}');
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    const first = cardOf('Next hearing');
    const second = cardOf('Comply with office objections');
    first.focus();
    await userEvent.keyboard('j');
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');
    await userEvent.keyboard('e');
    expect(onEdit).toHaveBeenLastCalledWith(objections);
    await userEvent.keyboard('x');
    await userEvent.keyboard('{Backspace}');
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(onDismiss).toHaveBeenLastCalledWith(objections);
    await userEvent.keyboard('k');
    expect(first).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onConfirm).toHaveBeenCalledWith(hearing);
  });

  it('offers Confirm all safe only for proposals the caller marked safe', async () => {
    const onConfirm = vi.fn<(proposal: Proposal<string>) => Promise<void>>(
      () => new Promise<void>(() => undefined),
    );
    const { rerender } = render(
      <ProposalCardGroup proposals={[objections]} onConfirm={onConfirm} />,
    );
    expect(screen.queryByRole('button', { name: 'Confirm all safe' })).toBeNull();
    rerender(<ProposalCardGroup proposals={PROPOSALS} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm all safe' }));
    expect(onConfirm.mock.calls.map(([proposal]) => proposal)).toEqual([hearing, affidavit]);
  });

  it('announces a confirmation, drops the card and moves focus on', async () => {
    reducedMotion(true);
    const onConfirmed = vi.fn();
    render(
      <ProposalCardGroup
        proposals={PROPOSALS}
        onConfirm={() => Promise.resolve()}
        onConfirmed={onConfirmed}
      />,
    );
    cardOf('Next hearing').focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Proposal confirmed');
    });
    expect(onConfirmed).toHaveBeenCalledWith(hearing);
    expect(screen.queryByRole('group', { name: 'Next hearing' })).toBeNull();
    expect(screen.getByRole('list', { name: '2 need you' })).toBeInTheDocument();
    expect(cardOf('Comply with office objections')).toHaveFocus();
  });

  it('shows the calm empty copy when nothing needs the lawyer', () => {
    render(<ProposalCardGroup proposals={[]} />);
    expect(screen.getByRole('heading', { name: 'Nothing needs you right now.' })).toBeVisible();
  });
});
