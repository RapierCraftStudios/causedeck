// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './icon-button';

describe('IconButton', () => {
  it('is named by its label and hides the icon from assistive tech', async () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Delete draft" onClick={onClick}>
        <Trash2 />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Delete draft' });
    expect(button).toHaveAttribute('data-slot', 'icon-button');
    expect(button).toHaveAttribute('title', 'Delete draft');
    expect(button).toHaveAttribute('data-variant', 'ghost');
    expect(button.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each([
    ['sm', 'size-8'],
    ['md', 'size-9'],
    ['lg', 'size-11'],
  ] as const)('is square at size %s (%s) with the coarse-pointer hit area', (size, cls) => {
    render(
      <IconButton label="Delete draft" size={size}>
        <Trash2 />
      </IconButton>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveClass(cls, 'px-0', 'pointer-coarse:hit');
    expect(button.className).not.toMatch(/(^|\s)h-(8|9|11)(\s|$)/);
  });

  it('announces loading through the labels prop and blocks clicks', () => {
    render(
      <IconButton label="சேமி" loading labels={{ loading: 'ஏற்றுகிறது' }}>
        <Trash2 />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'சேமி ஏற்றுகிறது' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
