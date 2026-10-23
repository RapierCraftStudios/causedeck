// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button, buttonVariants, DEFAULT_BUTTON_LABELS } from './button';

const VARIANTS = ['primary', 'secondary', 'ghost', 'outline', 'destructive', 'link'] as const;

describe('Button', () => {
  it('renders a type=button primary md button by default', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save draft</Button>);
    const button = screen.getByRole('button', { name: 'Save draft' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('data-size', 'md');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each(VARIANTS)('has a token-styled %s variant', (variant) => {
    render(<Button variant={variant}>{variant}</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant);
    expect(buttonVariants({ variant })).not.toBe(
      buttonVariants({ variant: 'primary', size: 'sm' }),
    );
  });

  it('sizes sm/md/lg are 32/36/44 px (h-8/h-9/h-11 on the 4 px spacing token)', () => {
    expect(buttonVariants({ size: 'sm' })).toContain('h-8');
    expect(buttonVariants({ size: 'md' })).toContain('h-9');
    expect(buttonVariants({ size: 'lg' })).toContain('h-11');
  });

  it('wraps Tamil and Kannada labels instead of overflowing, keeping the size as a minimum', () => {
    const INDIC = '[&:is(:lang(ta),:lang(kn))]:';
    for (const [size, height] of [
      ['sm', '8'],
      ['md', '9'],
      ['lg', '11'],
    ] as const) {
      const classes = buttonVariants({ size }).split(' ');
      expect(classes).toEqual(
        expect.arrayContaining([
          `${INDIC}whitespace-normal`,
          `${INDIC}h-auto`,
          `${INDIC}min-h-${height}`,
          `${INDIC}text-center`,
        ]),
      );
      // English is unchanged: one line at the fixed height.
      expect(classes).toEqual(expect.arrayContaining(['whitespace-nowrap', `h-${height}`]));
    }
  });

  it('guarantees the --hit area on coarse pointers', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(buttonVariants({ size })).toContain('pointer-coarse:hit');
    }
  });

  it('shows a spinner while loading without removing the label (no layout shift)', () => {
    render(<Button loading>Save draft</Button>);
    const button = screen.getByRole('button', {
      name: `Save draft ${DEFAULT_BUTTON_LABELS.loading}`,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    const label = button.querySelector('[data-slot="button-label"]');
    expect(label).toHaveTextContent('Save draft');
    expect(label).toHaveClass('opacity-0');
    // The spinner is absolutely positioned over the label, so it adds no width.
    expect(button.querySelector('[data-slot="button-spinner"]')).toHaveClass('absolute', 'inset-0');
    expect(button.querySelector('[data-slot="spinner"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('routes the loading announcement through the labels prop', () => {
    render(
      <Button loading labels={{ loading: 'ஏற்றுகிறது' }}>
        சேமி
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'சேமி ஏற்றுகிறது' })).toBeInTheDocument();
  });

  it('keeps the label visible and no spinner when idle', () => {
    render(<Button>Save draft</Button>);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button').querySelector('[data-slot="button-label"]')).not.toHaveClass(
      'opacity-0',
    );
  });

  it('renders its child with button styling when asChild', () => {
    render(
      <Button asChild variant="outline">
        <a href="#matters">Open matters</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Open matters' });
    expect(link).toHaveAttribute('data-slot', 'button');
    expect(link.className).toContain('border-line-control');
  });

  it('only uses token colour utilities (no arbitrary values)', () => {
    for (const variant of VARIANTS) {
      expect(buttonVariants({ variant })).not.toMatch(/-\[(#|rgb|hsl|oklch)/);
    }
  });
});
