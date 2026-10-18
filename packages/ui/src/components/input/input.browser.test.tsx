// Layout checks that need a real browser: the 36 px control height and invalid/focus styling.
import '../../styles/globals.css';

import { render, screen } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';

import { Combobox } from '../combobox/combobox';
import { Field } from '../field/field';
import { Select, SelectTrigger, SelectValue } from '../select/select';
import { Input } from './input';

describe('Form control layout', () => {
  it('Input, Select trigger and Combobox are 36 px tall', () => {
    render(
      <div className="w-80">
        <Input aria-label="Matter title" />
        <Select>
          <SelectTrigger aria-label="Court">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
        </Select>
        <Combobox aria-label="Bench" options={[]} />
      </div>,
    );
    for (const control of [
      screen.getByRole('textbox'),
      screen.getByRole('combobox', { name: 'Court' }),
      screen.getByRole('combobox', { name: 'Bench' }),
    ]) {
      expect(control.getBoundingClientRect().height).toBe(36);
    }
  });

  it('1 px --line-strong border on --surface-raised; focus adds a 2 px ring offset 2 and an --accent border', async () => {
    render(<Input aria-label="Matter title" />);
    const input = screen.getByRole('textbox');
    const root = getComputedStyle(document.documentElement);
    const probe = (variable: string) => {
      const el = document.createElement('span');
      el.style.color = `var(${variable})`;
      document.body.append(el);
      const color = getComputedStyle(el).color;
      el.remove();
      return color;
    };
    expect(root.getPropertyValue('--line-strong')).not.toBe('');
    let style = getComputedStyle(input);
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderTopColor).toBe(probe('--line-strong'));
    expect(style.backgroundColor).toBe(probe('--surface-raised'));

    await userEvent.keyboard('{Tab}');
    expect(input).toHaveFocus();
    style = getComputedStyle(input);
    expect(style.outlineWidth).toBe('2px');
    expect(style.outlineOffset).toBe('2px');
    // Colours transition over --dur-fast; wait for the end state.
    await expect.poll(() => getComputedStyle(input).outlineColor).toBe(probe('--ring'));
    await expect.poll(() => getComputedStyle(input).borderTopColor).toBe(probe('--accent'));
  });

  it('invalid: --danger border, icon and message below', () => {
    render(
      <Field label="Matter title" error="Enter the matter title.">
        <Input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Matter title' });
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    document.body.append(probe);
    expect(getComputedStyle(input).borderTopColor).toBe(getComputedStyle(probe).color);
    const error = screen.getByText('Enter the matter title.').closest('p');
    expect(error?.querySelector('svg')).not.toBeNull();
    expect(error?.getBoundingClientRect().top).toBeGreaterThan(
      input.getBoundingClientRect().bottom,
    );
  });
});
