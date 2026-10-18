// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { COURTS } from '../__fixtures__/labels';
import { Field } from '../field/field';
import { Combobox, DEFAULT_COMBOBOX_LABELS } from './combobox';

function Court(props: Partial<Parameters<typeof Combobox>[0]>) {
  return (
    <Field label="Court" hint="Where the matter is listed.">
      <Combobox options={COURTS} placeholder="Choose a court" {...props} />
    </Field>
  );
}

const activeOption = (input: HTMLElement) => {
  const id = input.getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};

describe('Combobox', () => {
  it('is an ARIA 1.2 list-autocomplete combobox, collapsed by default', () => {
    render(<Court />);
    const input = screen.getByRole('combobox', { name: 'Court' });
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-controls');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('ArrowDown opens and moves; ArrowUp wraps; disabled options are skipped', async () => {
    const user = userEvent.setup();
    render(<Court />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{Escape}');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox', { name: 'Court' });
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(activeOption(input)).toHaveTextContent(COURTS[0].label);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(activeOption(input)).toHaveTextContent(COURTS[3].label);
    // COURTS[4] is disabled.
    await user.keyboard('{ArrowDown}');
    expect(activeOption(input)).toHaveTextContent(COURTS[5].label);
    await user.keyboard('{ArrowDown}');
    expect(activeOption(input)).toHaveTextContent(COURTS[0].label);
    await user.keyboard('{ArrowUp}');
    expect(activeOption(input)).toHaveTextContent(COURTS[5].label);
  });

  it('Home and End jump to the first and last option', async () => {
    const user = userEvent.setup();
    render(<Court />);
    const input = screen.getByRole('combobox');
    input.focus();
    await user.keyboard('{ArrowDown}{End}');
    expect(activeOption(input)).toHaveTextContent(COURTS[5].label);
    await user.keyboard('{Home}');
    expect(activeOption(input)).toHaveTextContent(COURTS[0].label);
  });

  it('Enter selects, closes and shows the label; aria-selected follows', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Court onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox');
    input.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledWith(COURTS[1].value);
    expect(input).toHaveValue(COURTS[1].label);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: COURTS[1].label })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(activeOption(input)).toHaveTextContent(COURTS[1].label);
  });

  it('typing filters (case-insensitive) and Enter picks the first match', async () => {
    const user = userEvent.setup();
    const onInputValueChange = vi.fn();
    render(<Court onInputValueChange={onInputValueChange} />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'karnataka');
    expect(onInputValueChange).toHaveBeenLastCalledWith('karnataka');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      COURTS[2].label,
      COURTS[3].label,
    ]);
    await user.keyboard('{Enter}');
    expect(input).toHaveValue(COURTS[2].label);
  });

  it('shows the empty text when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Court labels={{ empty: 'பொருத்தம் இல்லை' }} />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.getByRole('status')).toHaveTextContent('பொருத்தம் இல்லை');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('Escape closes, then a second Escape clears the value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Court defaultValue="mhc-madurai" onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue(COURTS[1].label);
    input.focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue(COURTS[1].label);
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(onValueChange).toHaveBeenCalledWith(null);
  });

  it('Tab closes without selecting', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Court />
        <button type="button">Next</button>
      </>,
    );
    const input = screen.getByRole('combobox');
    input.focus();
    await user.keyboard('{ArrowDown}{Tab}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
  });

  it('clicking an option selects it', async () => {
    const user = userEvent.setup();
    render(<Court />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: COURTS[5].label }));
    expect(screen.getByRole('combobox')).toHaveValue(COURTS[5].label);
  });

  it('works controlled', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = useState<string | null>('khc-dharwad');
      return (
        <>
          <Court value={value} onValueChange={setValue} />
          <span data-testid="value">{value ?? 'none'}</span>
        </>
      );
    }
    render(<Controlled />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue(COURTS[3].label);
    input.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent(COURTS[5].value);
    expect(input).toHaveValue(COURTS[5].label);
  });

  it('read-only shows the value but does not open or edit', async () => {
    const user = userEvent.setup();
    render(<Court readOnly defaultValue="mhc-chennai" />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('readonly');
    await user.click(input);
    await user.keyboard('{ArrowDown}x');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue(COURTS[0].label);
  });

  it('loading marks aria-busy and announces the loading text', async () => {
    const user = userEvent.setup();
    render(<Court loading />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-busy', 'true');
    input.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('status')).toHaveTextContent(DEFAULT_COMBOBOX_LABELS.loading);
  });

  it('submits the value through a hidden input when named', () => {
    const { container } = render(<Court name="court" defaultValue="cmm-egmore" />);
    expect(container.querySelector('input[type="hidden"][name="court"]')).toHaveValue('cmm-egmore');
  });
});
