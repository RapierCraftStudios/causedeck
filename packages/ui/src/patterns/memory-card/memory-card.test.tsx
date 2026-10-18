// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MEMORIES } from '../__fixtures__/trust';
import { MEMORY_SCOPES } from '../types';
import { MEMORY_SCOPE_META, MemoryCard, MemoryCardSkeleton } from './memory-card';

describe('MemoryCard', () => {
  it.each(MEMORY_SCOPES)(
    'renders the %s scope pill, value and source chip from fixtures',
    (scope) => {
      const memory = MEMORIES[scope];
      const { container } = render(<MemoryCard {...memory} />);
      const pill = container.querySelector('[data-slot="memory-scope"]');
      expect(pill).toHaveTextContent(`${scope}·${MEMORY_SCOPE_META[scope].label}`);
      expect(screen.getByText(memory.value)).toBeInTheDocument();
      expect(screen.getByRole('article', { name: memory.title })).toHaveAttribute(
        'data-scope',
        scope,
      );
      expect(container.querySelector('[data-slot="provenance-chip"]')).toHaveAttribute(
        'data-source-state',
        memory.source.state,
      );
    },
  );

  it('offers Confirm while proposed, plus Edit and Delete, through plain callbacks', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <MemoryCard {...MEMORIES.M2} onConfirm={onConfirm} onEdit={onEdit} onDelete={onDelete} />,
    );
    await user.click(screen.getByRole('button', { name: 'Confirm memory: First hearings' }));
    await user.click(screen.getByRole('button', { name: 'Edit memory: First hearings' }));
    await user.click(screen.getByRole('button', { name: 'Delete memory: First hearings' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('drops Confirm once the memory is confirmed', () => {
    render(<MemoryCard {...MEMORIES.M3} onConfirm={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Confirm/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Edit/ })).toBeInTheDocument();
  });

  it('disables actions offline and hides them for view-only viewers', () => {
    const { rerender } = render(
      <MemoryCard {...MEMORIES.M2} offline onConfirm={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /^Confirm/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Delete/ })).toBeDisabled();
    expect(screen.getByText(/You are offline/)).toBeInTheDocument();
    rerender(<MemoryCard {...MEMORIES.M2} viewOnly onConfirm={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^(Confirm|Delete)/ })).toBeNull();
    expect(screen.getByText('View only')).toBeInTheDocument();
  });

  it('shows an error and never offers a send, file or pay action', () => {
    render(
      <MemoryCard
        {...MEMORIES.M6}
        error="Could not save."
        onConfirm={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save.');
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(/\b(send|file|pay)\b/i);
    }
  });

  it('has a loading skeleton', () => {
    const { container } = render(<MemoryCardSkeleton />);
    expect(container.querySelector('[data-slot="memory-skeleton"]')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('imports nothing from core, db or apps', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'memory-card.tsx'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]@causedeck\/(core|db|web|mobile)/);
    expect(source).not.toMatch(/from\s+['"](\.\.\/){3,}/);
  });
});
