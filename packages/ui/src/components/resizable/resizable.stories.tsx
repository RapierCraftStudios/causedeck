// check-stories: n/a Loading, Invalid (layout primitive: no loading or validation state)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor } from 'storybook/test';

import { INDIC, LONG_LABEL, MATTER_TITLE } from '../__fixtures__/labels';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type ResizableHandleProps,
  type ResizablePanelGroupProps,
} from './resizable';

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-ink flex h-full items-center justify-center p-4 text-center font-sans text-sm">
      {children}
    </div>
  );
}

function Layout({
  left = 'Matters',
  right = MATTER_TITLE,
  handle,
  ...props
}: ResizablePanelGroupProps & { left?: string; right?: string; handle?: ResizableHandleProps }) {
  return (
    <div className="border-line h-48 w-xl rounded-lg border">
      <ResizablePanelGroup {...props}>
        <ResizablePanel defaultSize="40%" minSize="20%">
          <Pane>{left}</Pane>
        </ResizablePanel>
        <ResizableHandle {...handle} />
        <ResizablePanel defaultSize="60%" minSize="20%">
          <Pane>{right}</Pane>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

const meta = {
  title: 'Components/Resizable',
  component: ResizablePanelGroup,
  args: { orientation: 'horizontal' },
  render: (args) => <Layout {...args} />,
} satisfies Meta<typeof ResizablePanelGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const valueOf = (el: HTMLElement) => Number(el.getAttribute('aria-valuenow'));

/** The library hit-tests pointer coordinates, so pointer events need real ones. */
const centre = (el: HTMLElement) => {
  const box = el.getBoundingClientRect();
  return { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
};

export const Default: Story = {
  play: async ({ canvas }) => {
    const handle = canvas.getByRole('separator', { name: 'Resize' });
    await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    await expect(Math.round(valueOf(handle))).toBe(40);
  },
};

export const Hover: Story = {
  play: async ({ canvas }) => {
    const handle = canvas.getByRole('separator');
    await userEvent.pointer({ target: handle, coords: centre(handle) });
    await waitFor(() => expect(handle).toHaveAttribute('data-separator', 'hover'));
  },
};

/** Keyboard: Tab to the handle (visible ring), arrows resize by 5 %, Home/End to the limits. */
export const FocusVisible: Story = {
  play: async ({ canvas }) => {
    const handle = canvas.getByRole('separator');
    await userEvent.tab();
    await expect(handle).toHaveFocus();
    await expect(handle.matches(':focus-visible')).toBe(true);
    const before = valueOf(handle);
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(valueOf(handle)).toBeGreaterThan(before));
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    await waitFor(() => expect(valueOf(handle)).toBeLessThan(before));
  },
};

export const Active: Story = {
  play: async ({ canvas }) => {
    const handle = canvas.getByRole('separator');
    const coords = centre(handle);
    await userEvent.pointer([
      { target: handle, coords },
      { keys: '[MouseLeft>]', target: handle, coords },
    ]);
    await waitFor(() => expect(handle).toHaveAttribute('data-separator', 'active'));
    await userEvent.pointer({ keys: '[/MouseLeft]', target: handle, coords });
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => <Layout {...args} handle={{ disabled: true }} />,
  play: async ({ canvas }) => {
    const handle = canvas.getByRole('separator');
    await expect(handle).toHaveAttribute('aria-disabled', 'true');
    await expect(handle).not.toHaveAttribute('tabindex');
  },
};

export const WithIcon: Story = {
  render: (args) => <Layout {...args} handle={{ withHandle: true }} />,
};

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => <Layout {...args} handle={{ withHandle: true }} />,
  play: async ({ canvas }) => {
    const handle = canvas.getByRole('separator');
    await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    handle.focus();
    const before = valueOf(handle);
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(valueOf(handle)).toBeGreaterThan(before));
  },
};

export const LongText: Story = {
  render: (args) => <Layout {...args} left={LONG_LABEL} right={LONG_LABEL} />,
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl">
      <Layout {...args} handle={{ withHandle: true }} />
    </div>
  ),
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta">
      <Layout
        {...args}
        left={INDIC.ta.hearing}
        right={INDIC.ta.upload}
        handle={{ withHandle: true, labels: { handle: INDIC.ta.resize } }}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('separator', { name: INDIC.ta.resize })).toBeInTheDocument();
  },
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn">
      <Layout
        {...args}
        left={INDIC.kn.hearing}
        right={INDIC.kn.upload}
        handle={{ withHandle: true, labels: { handle: INDIC.kn.resize } }}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('separator', { name: INDIC.kn.resize })).toBeInTheDocument();
  },
};
