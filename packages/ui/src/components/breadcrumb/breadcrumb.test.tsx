// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  DEFAULT_BREADCRUMB_LABELS,
} from './breadcrumb';

function Example({ labels }: { labels?: { nav?: string; more?: string } }) {
  return (
    <Breadcrumb labels={labels}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/matters">Matters</BreadcrumbLink>
          <BreadcrumbSeparator />
        </BreadcrumbItem>
        <BreadcrumbItem>
          <BreadcrumbEllipsis labels={labels} />
          <BreadcrumbSeparator />
        </BreadcrumbItem>
        <BreadcrumbItem>
          <BreadcrumbPage>M/s Kaveri Textiles v. State of Tamil Nadu</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

describe('Breadcrumb', () => {
  it('is a labelled nav with an ordered list and the current page marked', () => {
    render(<Example />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelector('ol')).toHaveAttribute('data-slot', 'breadcrumb-list');
    expect(screen.getByText(/Kaveri/)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Matters' })).toHaveAttribute('href', '/matters');
    expect(screen.getByText('More pages')).toHaveClass('sr-only');
    for (const separator of nav.querySelectorAll('[data-slot="breadcrumb-separator"]')) {
      expect(separator).toHaveAttribute('aria-hidden', 'true');
      expect(separator.className).toContain('rtl:[&_svg]:rotate-180');
    }
  });

  it('routes strings through labels with English defaults', () => {
    expect(DEFAULT_BREADCRUMB_LABELS).toEqual({ nav: 'Breadcrumb', more: 'More pages' });
    render(<Example labels={{ nav: 'வழிசெலுத்தல்', more: 'மேலும்' }} />);
    expect(screen.getByRole('navigation', { name: 'வழிசெலுத்தல்' })).toBeInTheDocument();
    expect(screen.getByText('மேலும்')).toBeInTheDocument();
  });

  it('supports asChild links', () => {
    render(
      <BreadcrumbLink asChild>
        <a href="/today">Today</a>
      </BreadcrumbLink>,
    );
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute(
      'data-slot',
      'breadcrumb-link',
    );
  });
});
