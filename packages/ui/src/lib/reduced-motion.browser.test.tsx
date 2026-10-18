// prefers-reduced-motion in a real browser (Playwright `emulateMedia`): the hook, the motion
// presets and the components must make state changes instant with no transform or opacity motion.
import '../styles/globals.css';

import { render, screen } from '@testing-library/react';
import { commands } from '@vitest/browser/context';
import { motion as m } from 'motion/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from '../components/button';
import { Spinner } from '../components/spinner';
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
});
