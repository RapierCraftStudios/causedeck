// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Field } from '../field/field';
import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('toggles with click and Space', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Urgent" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Urgent' });
    await userEvent.click(box);
    expect(box).toBeChecked();
    await userEvent.keyboard(' ');
    expect(box).not.toBeChecked();
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });

  it('indeterminate is aria-checked="mixed"', () => {
    render(<Checkbox aria-label="All" checked="indeterminate" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed');
  });

  it('read-only ignores clicks and keys', async () => {
    render(<Checkbox aria-label="Urgent" readOnly defaultChecked />);
    const box = screen.getByRole('checkbox');
    expect(box).toHaveAttribute('aria-readonly', 'true');
    await userEvent.click(box);
    await userEvent.keyboard(' ');
    expect(box).toBeChecked();
  });

  it('labelled by a horizontal Field and invalid with an error', async () => {
    render(
      <Field label="Mark as urgent" orientation="horizontal" error="Required.">
        <Checkbox />
      </Field>,
    );
    const box = screen.getByRole('checkbox', { name: 'Mark as urgent' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(screen.getByText('Mark as urgent'));
    expect(box).toBeChecked();
  });
});
