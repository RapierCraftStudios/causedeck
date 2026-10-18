// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_RESIZABLE_LABELS,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from './resizable';

// jsdom has no ResizeObserver; the panels measure themselves with one.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function Layout({ withHandle = false, disabled = false }) {
  return (
    <ResizablePanelGroup orientation="horizontal" disabled={disabled}>
      <ResizablePanel defaultSize="40%">Matters</ResizablePanel>
      <ResizableHandle withHandle={withHandle} disabled={disabled} />
      <ResizablePanel defaultSize="60%">Documents</ResizablePanel>
    </ResizablePanelGroup>
  );
}

describe('Resizable', () => {
  it('renders a named, focusable vertical separator between panels', () => {
    render(<Layout />);
    const handle = screen.getByRole('separator', { name: DEFAULT_RESIZABLE_LABELS.handle });
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveClass('bg-line', 'focus-visible:outline-ring');
    expect(screen.getByText('Matters')).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();
  });

  it('routes the handle name through the labels prop and shows an optional grip', () => {
    const { container } = render(
      <ResizablePanelGroup>
        <ResizablePanel>A</ResizablePanel>
        <ResizableHandle withHandle labels={{ handle: 'அளவை மாற்று' }} />
        <ResizablePanel>B</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(screen.getByRole('separator', { name: 'அளவை மாற்று' })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="resizable-grip"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('marks a disabled handle aria-disabled and removes it from the tab order', () => {
    render(<Layout disabled />);
    const handle = screen.getByRole('separator');
    expect(handle).toHaveAttribute('aria-disabled', 'true');
    expect(handle).not.toHaveAttribute('tabindex');
  });
});
