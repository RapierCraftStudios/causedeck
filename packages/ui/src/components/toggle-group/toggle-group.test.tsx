// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Field } from '../field/field';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';

describe('ToggleGroup', () => {
  it('single: one item pressed, arrows move focus', async () => {
    render(
      <Field label="Board view" error="Pick a view.">
        <ToggleGroup type="single" defaultValue="day">
          <ToggleGroupItem value="day">Day</ToggleGroupItem>
          <ToggleGroupItem value="week">Week</ToggleGroupItem>
        </ToggleGroup>
      </Field>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Board view' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Week' }));
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'false');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Day' })).toHaveFocus();
  });

  it('multiple: items toggle independently and share the group size', async () => {
    render(
      <ToggleGroup type="multiple" size="sm" aria-label="Filters">
        <ToggleGroupItem value="urgent">Urgent</ToggleGroupItem>
        <ToggleGroupItem value="mine">Mine</ToggleGroupItem>
      </ToggleGroup>,
    );
    const urgent = screen.getByRole('button', { name: 'Urgent' });
    await userEvent.click(urgent);
    await userEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(urgent).toHaveAttribute('aria-pressed', 'true');
    expect(urgent).toHaveClass('h-8');
  });
});
