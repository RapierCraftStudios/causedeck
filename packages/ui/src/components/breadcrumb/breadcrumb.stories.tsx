// check-stories: n/a Loading, Invalid (static navigation trail with no async or value state)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Home } from 'lucide-react';
import type { ComponentProps } from 'react';
import { expect, userEvent } from 'storybook/test';

import { BREADCRUMB_TRAIL, MATTER_TITLE, OVERLAY_INDIC } from '../__fixtures__/overlays';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb';

interface ExampleProps extends ComponentProps<typeof Breadcrumb> {
  trail?: readonly string[];
  icon?: boolean;
  collapsed?: boolean;
}

function Example({
  trail = BREADCRUMB_TRAIL,
  icon = false,
  collapsed = false,
  ...props
}: ExampleProps) {
  const links = trail.slice(0, -1);
  const page = trail.at(-1) ?? '';
  return (
    <Breadcrumb className="max-w-md" {...props}>
      <BreadcrumbList>
        {links.map((link, index) => (
          <BreadcrumbItem key={link}>
            {collapsed && index > 0 ? (
              <BreadcrumbEllipsis labels={props.labels} />
            ) : (
              <BreadcrumbLink href={`#${String(index)}`}>
                {icon && index === 0 ? <Home aria-hidden="true" /> : null}
                {link}
              </BreadcrumbLink>
            )}
            <BreadcrumbSeparator />
          </BreadcrumbItem>
        ))}
        <BreadcrumbItem>
          <BreadcrumbPage>{page}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

const meta = {
  title: 'Components/Breadcrumb',
  component: Example,
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    await expect(canvas.getByText(MATTER_TITLE)).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getAllByRole('link')).toHaveLength(2);
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Matters' });
    await userEvent.hover(link);
    await expect(link.className).toMatch(/hover:underline/);
  },
};

export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    await userEvent.tab();
    const link = canvas.getByRole('link', { name: 'Matters' });
    await expect(link).toHaveFocus();
    await expect(link.matches(':focus-visible')).toBe(true);
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Matters' });
    await userEvent.pointer({ keys: '[MouseLeft>]', target: link });
    await expect(link.className).toMatch(/active:/);
    await userEvent.pointer({ keys: '[/MouseLeft]', target: link });
  },
};

/** The current page is not a link: it cannot be activated. */
export const Disabled: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('link', { name: MATTER_TITLE })).toBeNull();
  },
};

export const Collapsed: Story = {
  args: {
    collapsed: true,
    trail: ['Matters', 'Madras High Court', 'Writ petitions', MATTER_TITLE],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('More pages')).toHaveLength(2);
  },
};

export const WithIcon: Story = { args: { icon: true } };

export const LongText: Story = {
  args: { trail: ['Matters', MATTER_TITLE, `Hearing record of ${MATTER_TITLE}`] },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation').getBoundingClientRect().width).toBeLessThanOrEqual(
      448,
    );
  },
};

/** Separators point along the reading direction. */
export const RtlNeutral: Story = { args: { dir: 'rtl' } };

export const Tamil: Story = {
  args: {
    lang: 'ta',
    trail: [OVERLAY_INDIC.ta.matters, ...OVERLAY_INDIC.ta.tabs.slice(0, 2)],
    labels: { nav: OVERLAY_INDIC.ta.matters },
  },
};

export const Kannada: Story = {
  args: {
    lang: 'kn',
    trail: [OVERLAY_INDIC.kn.matters, ...OVERLAY_INDIC.kn.tabs.slice(0, 2)],
    labels: { nav: OVERLAY_INDIC.kn.matters },
  },
};
