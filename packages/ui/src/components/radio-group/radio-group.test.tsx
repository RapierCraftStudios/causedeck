// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Field } from '../field/field';
import { RadioGroup, RadioGroupItem } from './radio-group';

function Stage({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <Field label="Stage" hint="Current stage." readOnly={readOnly}>
      <RadioGroup defaultValue="filed">
        <RadioGroupItem value="filed" aria-label="Filed" />
        <RadioGroupItem value="listed" aria-label="Listed" />
      </RadioGroup>
    </Field>
  );
}

describe('RadioGroup', () => {
  it('is a radiogroup named by its Field; click selects, arrows move focus', async () => {
    render(<Stage />);
    expect(screen.getByRole('radiogroup', { name: 'Stage' })).toHaveAccessibleDescription(
      'Current stage.',
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Listed' }));
    expect(screen.getByRole('radio', { name: 'Listed' })).toBeChecked();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: 'Filed' })).toHaveFocus();
  });

  it('read-only keeps the selection', async () => {
    render(<Stage readOnly />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-readonly', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Listed' }));
    expect(screen.getByRole('radio', { name: 'Filed' })).toBeChecked();
  });
});
