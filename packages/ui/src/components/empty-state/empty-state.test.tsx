// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { FolderOpen } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders a title, one-line explanation and primary action without an illustration', () => {
    const { container } = render(
      <EmptyState
        title="No matters yet"
        description="Add your first matter to start tracking hearings."
        action={<button type="button">Add matter</button>}
      />,
    );
    expect(screen.getByText('No matters yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add your first matter to start tracking hearings.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add matter' })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-slot="empty-state-icon"]')).toBeNull();
  });

  it('renders a decorative icon and a secondary action', () => {
    const { container } = render(
      <EmptyState
        icon={<FolderOpen />}
        title="No documents"
        action={<button type="button">Upload</button>}
        secondaryAction={<button type="button">Learn more</button>}
      />,
    );
    expect(container.querySelector('[data-slot="empty-state-icon"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('omits the actions row when there is no action', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container.querySelector('[data-slot="empty-state-actions"]')).toBeNull();
  });
});
