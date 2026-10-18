// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Spinner } from './spinner';

describe('Spinner', () => {
  it('announces an English default label', () => {
    render(<Spinner />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('takes its label from the labels prop', () => {
    render(<Spinner labels={{ loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ' }} />);
    expect(screen.getByRole('status', { name: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ' })).toBeInTheDocument();
  });

  it('is hidden from assistive tech when decorative', () => {
    const { container } = render(<Spinner decorative />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies the size scale', () => {
    const { container } = render(<Spinner size="lg" />);
    expect(container.firstElementChild).toHaveClass('size-5');
  });
});
