// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Alert, AlertDescription, AlertTitle, type AlertTone } from './alert';

const TONES: AlertTone[] = ['neutral', 'info', 'success', 'warning', 'danger'];

describe('Alert', () => {
  it('uses role=status for non-danger tones and role=alert for danger', () => {
    render(
      <>
        <Alert tone="info">
          <AlertTitle>Saved</AlertTitle>
        </Alert>
        <Alert tone="danger">
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>The file is larger than 25 MB.</AlertDescription>
        </Alert>
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed');
  });

  it.each(TONES)('shows a decorative icon for the %s tone', (tone) => {
    const { container } = render(<Alert tone={tone}>Text</Alert>);
    const icon = container.querySelector('[data-slot="alert-icon"]');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.querySelector('svg')).not.toBeNull();
  });

  it('accepts a custom icon, no icon and an action', () => {
    const { container, rerender } = render(
      <Alert icon={<span data-testid="lock" />} action={<button type="button">Try again</button>}>
        Text
      </Alert>,
    );
    expect(screen.getByTestId('lock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' }).parentElement).toHaveAttribute(
      'data-slot',
      'alert-action',
    );
    rerender(<Alert icon={null}>Text</Alert>);
    expect(container.querySelector('[data-slot="alert-icon"]')).toBeNull();
  });
});
