// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { INDIC, PEOPLE } from '../__fixtures__/labels';
import { Avatar, initials } from './avatar';

describe('initials', () => {
  it('takes the first letter of the first and last word', () => {
    expect(initials(PEOPLE.advocate)).toBe('MR');
    expect(initials(PEOPLE.long)).toBe('VS');
    expect(initials('  farhan  ')).toBe('F');
    expect(initials('')).toBe('');
  });

  it('keeps Tamil and Kannada grapheme clusters whole', () => {
    expect(initials(INDIC.ta.person)).toBe('மீரா');
    expect(initials(INDIC.kn.person)).toBe('ಅಗೌ');
  });
});

describe('Avatar', () => {
  it('shows initials named by the person until an image loads', () => {
    render(<Avatar name={PEOPLE.advocate} src="/photos/meenakshi.jpg" />);
    const fallback = screen.getByRole('img', { name: PEOPLE.advocate });
    expect(fallback).toHaveTextContent('MR');
    expect(fallback.querySelector('[aria-hidden="true"]')).toHaveTextContent('MR');
  });

  it.each([
    ['sm', 'size-6'],
    ['md', 'size-8'],
    ['lg', 'size-10'],
  ] as const)('applies size %s', (size, cls) => {
    const { container } = render(<Avatar name={PEOPLE.junior} size={size} />);
    expect(container.firstElementChild).toHaveClass(cls, 'rounded-full');
  });
});
