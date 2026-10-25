// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Progress } from './progress';

describe('Progress', () => {
  it('exposes value, max and its name', () => {
    render(<Progress aria-label="Upload" value={40} />);
    const bar = screen.getByRole('progressbar', { name: 'Upload' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar.querySelector('[data-slot="progress-indicator"]')).toHaveStyle({ width: '40%' });
  });

  it('clamps and scales to max', () => {
    render(<Progress aria-label="Pages" value={30} max={20} />);
    const indicator = screen.getByRole('progressbar').firstElementChild;
    expect(indicator).toHaveStyle({ width: '100%' });
  });

  it('is busy with no value when indeterminate', () => {
    render(<Progress aria-label="Indexing" value={null} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-busy', 'true');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('data-state', 'indeterminate');
  });

  it('animates width with the motion tokens and supports a danger tone', () => {
    render(<Progress aria-label="Upload" value={10} tone="danger" />);
    const indicator = screen.getByRole('progressbar').firstElementChild;
    expect(indicator).toHaveClass('bg-danger', 'duration-(--dur-base)');
  });

  it('supports a warning tone for a level nearing its limit', () => {
    render(<Progress aria-label="AI processing" value={80} tone="warning" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('data-tone', 'warning');
    expect(bar.firstElementChild).toHaveClass('bg-warning');
  });
});
