// prefers-reduced-motion in a real browser (Playwright `emulateMedia`): the hook, the motion
// presets and the components must make state changes instant with no transform or opacity motion.
import '../styles/globals.css';

import { render, screen } from '@testing-library/react';
import { motion as m } from 'motion/react';
import { commands, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import { Combobox } from '../components/combobox';
import { Input } from '../components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select';
import { Slider } from '../components/slider';
import { Spinner } from '../components/spinner';
import { Switch } from '../components/switch';
import { Toggle } from '../components/toggle';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { getMotionPreset } from './motion';

function Panel() {
  const reduced = useReducedMotion();
  return (
    <m.div
      data-testid="panel"
      data-reduced={String(reduced)}
      {...getMotionPreset('fadeUp', reduced)}
    >
      Hearing moved to 14 Nov
    </m.div>
  );
}

afterEach(async () => {
  await commands.emulateReducedMotion('no-preference');
});

describe('prefers-reduced-motion: reduce', () => {
  it('useReducedMotion reports it and presets render the final state at once', async () => {
    await commands.emulateReducedMotion('reduce');
    render(<Panel />);
    const panel = screen.getByTestId('panel');
    expect(panel).toHaveAttribute('data-reduced', 'true');
    const style = getComputedStyle(panel);
    expect(style.opacity).toBe('1');
    expect(style.transform).toBe('none');
  });

  it('stops the spinner rotation', async () => {
    await commands.emulateReducedMotion('reduce');
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('no svg');
    expect(getComputedStyle(svg).animationName).toBe('none');
  });

  it('makes form control state changes instant (switch thumb, checkbox, input, slider, toggle)', async () => {
    await commands.emulateReducedMotion('reduce');
    render(
      <>
        <Switch aria-label="Remind me" />
        <Checkbox aria-label="Urgent" />
        <Input aria-label="Matter title" />
        <Slider aria-label="Days" defaultValue={[3]} />
        <Toggle>Urgent only</Toggle>
      </>,
    );
    const toggle = screen.getByRole('switch');
    const thumb = toggle.querySelector('[data-slot="switch-thumb"]');
    if (!thumb) throw new Error('no thumb');
    const elements = [
      toggle,
      thumb,
      screen.getByRole('checkbox'),
      screen.getByRole('textbox'),
      screen.getByRole('slider'),
      screen.getByRole('button', { name: 'Urgent only' }),
    ];
    for (const element of elements) {
      expect(Number.parseFloat(getComputedStyle(element).transitionDuration)).toBeLessThan(0.001);
    }
    // The thumb jumps straight to its checked position.
    await userEvent.click(toggle);
    // Tailwind v4 translate utilities set the `translate` property.
    expect(getComputedStyle(thumb).translate).toBe('16px');
  });

  it('opens the select list without animation', async () => {
    await commands.emulateReducedMotion('reduce');
    render(
      <>
        <Select defaultOpen>
          <SelectTrigger aria-label="Court">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mhc">Madras High Court</SelectItem>
          </SelectContent>
        </Select>
      </>,
    );
    const select = document.querySelector('[data-slot="select-content"]');
    if (!select) throw new Error('no select content');
    expect(getComputedStyle(select).animationName).toBe('none');
  });

  it('opens the combobox list without animation', async () => {
    await commands.emulateReducedMotion('reduce');
    render(
      <Combobox aria-label="Court" options={[{ value: 'mhc', label: 'Madras High Court' }]} />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    const list = await screen.findByRole('listbox');
    expect(getComputedStyle(list).animationName).toBe('none');
    expect(getComputedStyle(list).opacity).toBe('1');
  });

  it('makes button state transitions instant', async () => {
    await commands.emulateReducedMotion('reduce');
    render(<Button>Save draft</Button>);
    const duration = Number.parseFloat(
      getComputedStyle(screen.getByRole('button')).transitionDuration,
    );
    expect(duration).toBeLessThan(0.001);
  });
});

describe('prefers-reduced-motion: no-preference (control)', () => {
  it('animates the preset from its hidden state', async () => {
    await commands.emulateReducedMotion('no-preference');
    render(<Panel />);
    const panel = screen.getByTestId('panel');
    expect(panel).toHaveAttribute('data-reduced', 'false');
    expect(Number(getComputedStyle(panel).opacity)).toBeLessThan(1);
  });

  it('rotates the spinner and transitions the button with token durations', async () => {
    await commands.emulateReducedMotion('no-preference');
    const { container } = render(
      <>
        <Spinner />
        <Button>Save draft</Button>
      </>,
    );
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('no svg');
    expect(getComputedStyle(svg).animationName).toBe('cd-spinner-rotate');
    expect(getComputedStyle(screen.getByRole('button')).transitionDuration).toBe('0.15s');
  });

  it('slides the switch thumb and fades in the combobox list', async () => {
    await commands.emulateReducedMotion('no-preference');
    render(
      <>
        <Switch aria-label="Remind me" />
        <Combobox aria-label="Court" options={[{ value: 'mhc', label: 'Madras High Court' }]} />
      </>,
    );
    const thumb = screen.getByRole('switch').querySelector('[data-slot="switch-thumb"]');
    if (!thumb) throw new Error('no thumb');
    expect(getComputedStyle(thumb).transitionDuration).toBe('0.15s');
    await userEvent.click(screen.getByRole('combobox'));
    expect(getComputedStyle(await screen.findByRole('listbox')).animationName).toBe('fade-in');
  });
});
