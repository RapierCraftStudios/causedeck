// check-stories: n/a Loading, Invalid (page links have no async or value state; the list they page owns loading)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState, type ComponentProps } from 'react';
import { expect, userEvent } from 'storybook/test';

import { OVERLAY_INDIC } from '../__fixtures__/overlays';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './pagination';

interface ExampleProps extends ComponentProps<typeof Pagination> {
  pages?: number;
  start?: number;
}

function Example({ pages = 10, start = 2, labels, ...props }: ExampleProps) {
  const [page, setPage] = useState(start);
  const visible = [1, page - 1, page, page + 1, pages].filter(
    (p, i, all) => p >= 1 && p <= pages && all.indexOf(p) === i,
  );
  const go = (p: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    setPage(p);
  };
  return (
    <Pagination labels={labels} {...props}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#previous"
            labels={labels}
            disabled={page === 1}
            onClick={go(page - 1)}
          />
        </PaginationItem>
        {visible.map((p, i) => (
          <PaginationItem key={p}>
            {i > 0 && p - (visible[i - 1] ?? p) > 1 ? <PaginationEllipsis labels={labels} /> : null}
            <PaginationLink href={`#page-${String(p)}`} isActive={p === page} onClick={go(p)}>
              {p}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            href="#next"
            labels={labels}
            disabled={page === pages}
            onClick={go(page + 1)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

const meta = {
  title: 'Components/Pagination',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: '2' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(canvas.getByRole('link', { name: 'Go to next page' }));
    await expect(canvas.getByRole('link', { name: '3' })).toHaveAttribute('aria-current', 'page');
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: '3' });
    await userEvent.hover(link);
    await expect(link).not.toHaveAttribute('aria-current');
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const previous = canvas.getByRole('link', { name: 'Go to previous page' });
    await expect(previous).toHaveFocus();
    await expect(previous.matches(':focus-visible')).toBe(true);
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: '3' });
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: link },
      { keys: '[/MouseLeft]', target: link },
    ]);
    await expect(link).toHaveAttribute('aria-current', 'page');
  },
};

export const Disabled: Story = {
  args: { start: 1 },
  play: async ({ canvas }) => {
    const previous = canvas.getByRole('link', { name: 'Go to previous page' });
    await expect(previous).toHaveAttribute('aria-disabled', 'true');
    await expect(previous).not.toHaveAttribute('href');
  },
};

/** Previous and next carry chevrons that flip in RTL. */
export const WithIcon: Story = { args: { start: 5 } };

export const LongText: Story = {
  args: { pages: 1250, start: 640 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: '1250' })).toBeInTheDocument();
  },
};

export const RtlNeutral: Story = { args: { dir: 'rtl', start: 5 } };

const indic = (lang: 'ta' | 'kn'): Story => ({
  args: {
    lang,
    start: 5,
    labels: {
      previous: OVERLAY_INDIC[lang].previous,
      next: OVERLAY_INDIC[lang].next,
      goToPrevious: OVERLAY_INDIC[lang].previous,
      goToNext: OVERLAY_INDIC[lang].next,
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: OVERLAY_INDIC[lang].next })).toBeInTheDocument();
  },
});

export const Tamil: Story = indic('ta');
export const Kannada: Story = indic('kn');
