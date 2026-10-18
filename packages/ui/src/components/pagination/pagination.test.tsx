// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGINATION_LABELS,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  type PaginationLabels,
} from './pagination';

function Example({ labels }: { labels?: Partial<PaginationLabels> }) {
  return (
    <Pagination labels={labels}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#p" labels={labels} disabled />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#1" isActive>
            1
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis labels={labels} />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#n" labels={labels} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

describe('Pagination', () => {
  it('is a labelled nav with the current page marked', () => {
    render(<Example />);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toHaveAttribute('data-slot', 'pagination');
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Go to next page' })).toHaveTextContent('Next');
    expect(screen.getByText('More pages')).toHaveClass('sr-only');
  });

  it('disables a step link without an href', () => {
    render(<Example />);
    const previous = screen.getByRole('link', { name: 'Go to previous page' });
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(previous).not.toHaveAttribute('href');
    expect(previous.querySelector('svg')).toHaveClass('rtl:rotate-180');
  });

  it('routes every string through labels with English defaults', () => {
    expect(DEFAULT_PAGINATION_LABELS).toEqual({
      nav: 'Pagination',
      previous: 'Previous',
      next: 'Next',
      goToPrevious: 'Go to previous page',
      goToNext: 'Go to next page',
      more: 'More pages',
    });
    render(
      <Example
        labels={{ nav: 'பக்கங்கள்', next: 'அடுத்து', goToNext: 'அடுத்த பக்கம்', more: 'மேலும்' }}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'பக்கங்கள்' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'அடுத்த பக்கம்' })).toHaveTextContent('அடுத்து');
    expect(screen.getByText('மேலும்')).toBeInTheDocument();
  });
});
