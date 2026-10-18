// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LEVELS, type Level } from '../types';
import { LEVEL_META, LevelBadge } from './level-badge';
import { LevelLegend } from './level-legend';

const EXPECTED: Record<Level, [label: string, token: string]> = {
  L1: ['Suggested', '--level-l1'],
  L2: ['Needs your confirmation', '--level-l2'],
  L3: ['Applied, undo available', '--level-l3'],
  L4: ['Draft for you to share', '--level-l4'],
};

describe('LevelBadge', () => {
  it.each(LEVELS)('%s renders its ladder icon, label and colour token', (level) => {
    const [label, token] = EXPECTED[level];
    const { container } = render(<LevelBadge level={level} />);
    const badge = container.querySelector('[data-slot="level-badge"]');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('data-level', level);
    expect(LEVEL_META[level].token).toBe(token);
    expect(badge).toHaveClass(`border-level-${level.toLowerCase()}`);
    const ladder = container.querySelector('[data-slot="level-ladder"]');
    expect(ladder).toHaveAttribute('aria-hidden', 'true');
    const filled = ladder?.querySelectorAll('[data-filled]') ?? [];
    expect(filled).toHaveLength(Number(level.slice(1)));
    for (const step of filled) expect(step).toHaveClass(`bg-level-${level.toLowerCase()}`);
  });

  it('supports only L1-L4', () => {
    expect(LEVELS).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(Object.keys(LEVEL_META)).toEqual(['L1', 'L2', 'L3', 'L4']);
    // @ts-expect-error there is no L5: nothing is sent, filed or paid on the lawyer's behalf
    const badge = <LevelBadge level="L5" />;
    // @ts-expect-error `Level` has no L5
    const level: Level = 'L5';
    expect((badge.props as { level: string }).level).toBe(level);
  });

  it('explains the level in a tooltip and links to the privacy page via callback', async () => {
    const onLearnMore = vi.fn();
    render(<LevelBadge level="L2" onLearnMore={onLearnMore} />);
    const badge = screen.getByRole('button', {
      name: 'Automation level 2 of 4: Needs your confirmation',
    });
    await userEvent.hover(badge);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'It applies only after you confirm it.',
    );
    await userEvent.click(badge);
    expect(onLearnMore).toHaveBeenCalledOnce();
  });

  it('never claims anything was sent, and leaves sharing to the lawyer', () => {
    for (const level of LEVELS) {
      const { label, description } = LEVEL_META[level];
      expect(`${label} ${description}`).not.toMatch(/\b(sent|send|filed|paid)\b/i);
    }
    expect(LEVEL_META.L4.description).toMatch(/Only you can share/);
  });
});

describe('LevelLegend', () => {
  it('lists every level with its label and meaning', async () => {
    const onLearnMore = vi.fn();
    render(<LevelLegend onLearnMore={onLearnMore} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[2]).toHaveTextContent('L3 · Applied, undo available');
    await userEvent.click(screen.getByRole('button', { name: 'How levels and privacy work' }));
    expect(onLearnMore).toHaveBeenCalledOnce();
  });
});
