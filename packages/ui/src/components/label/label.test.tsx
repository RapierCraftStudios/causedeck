// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DEFAULT_LABEL_LABELS, Label } from './label';

describe('Label', () => {
  it('names and focuses its control', async () => {
    render(
      <>
        <Label htmlFor="matter">Matter title</Label>
        <input id="matter" />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Matter title' });
    await userEvent.click(screen.getByText('Matter title'));
    expect(input).toHaveFocus();
  });

  it('required: visible asterisk is hidden, the word comes from labels', () => {
    render(
      <>
        <Label htmlFor="court" required labels={{ required: 'அவசியம்' }}>
          Court
        </Label>
        <input id="court" />
      </>,
    );
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('textbox', { name: /^Court\s*அவசியம்$/ })).toBeInTheDocument();
    expect(DEFAULT_LABEL_LABELS.required).toBe('required');
  });
});
