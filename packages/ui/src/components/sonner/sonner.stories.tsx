// check-stories: n/a Active, Disabled (toasts have no pressed or disabled state; their buttons are Buttons)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useEffect } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Button } from '../button/button';
import { INDIC, LONG_LABEL, MATTER_TITLE } from '../__fixtures__/labels';
import { MAX_VISIBLE_TOASTS, toast, Toaster, type ToasterProps } from './sonner';

/** Clears toasts left by a previous story (sonner keeps them in module state). */
function Fresh({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    toast.dismiss();
    return () => {
      toast.dismiss();
    };
  }, []);
  return children;
}

function Demo({
  fire,
  label = 'Save draft',
  ...props
}: ToasterProps & { fire: () => void; label?: string }) {
  return (
    <Fresh>
      <Button onClick={fire}>{label}</Button>
      <Toaster {...props} />
    </Fresh>
  );
}

const meta = {
  title: 'Components/Sonner',
  component: Toaster,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex min-h-96 items-start p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

const toastRegion = () => within(document.body).getByRole('region', { name: /^Notifications/ });

const findToast = (text: string) =>
  waitFor(() => {
    const el = within(toastRegion()).getByText(text).closest<HTMLElement>('[data-sonner-toast]');
    if (!el) throw new Error(`no toast "${text}"`);
    return el;
  });

/** Keyboard: Enter on the trigger, the toast appears in a polite live region. */
export const Default: Story = {
  render: (args) => <Demo {...args} fire={() => toast('Draft saved', { duration: Infinity })} />,
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Save draft' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const item = await findToast('Draft saved');
    await expect(toastRegion()).toHaveAttribute('aria-live', 'polite');
    await expect(getComputedStyle(item).borderTopLeftRadius).toBe('12px');
  },
};

/** Undo action: activating it from the keyboard runs the callback and closes the toast. */
export const WithAction: Story = {
  render: (args) => (
    <Demo
      {...args}
      label="Delete draft"
      fire={() =>
        toast('Draft deleted', {
          duration: Infinity,
          action: { label: 'Undo', onClick: () => toast('Draft restored', { duration: Infinity }) },
        })
      }
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Delete draft' }));
    await findToast('Draft deleted');
    within(toastRegion()).getByRole('button', { name: 'Undo' }).focus();
    await userEvent.keyboard('{Enter}');
    await findToast('Draft restored');
    await waitFor(() => expect(within(toastRegion()).queryByText('Draft deleted')).toBeNull());
  },
};

/**
 * Toast dismissal from the keyboard: alt+T moves focus to the notifications, Tab reaches the
 * toast's close button, Enter dismisses it.
 */
export const KeyboardDismiss: Story = {
  render: (args) => <Demo {...args} fire={() => toast('Hearing listed', { duration: Infinity })} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    await findToast('Hearing listed');
    await userEvent.keyboard('{Alt>}t{/Alt}');
    const close = within(toastRegion()).getByRole('button', { name: 'Dismiss notification' });
    for (let i = 0; i < 4 && document.activeElement !== close; i++) await userEvent.tab();
    await expect(close).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(within(toastRegion()).queryByText('Hearing listed')).toBeNull());
  },
};

/** Five toasts fired, at most three stacked; hovering expands the stack. */
export const Stack: Story = {
  render: (args) => (
    <Demo
      {...args}
      label="Fire five"
      fire={() => {
        for (let i = 1; i <= 5; i++) toast(`Hearing ${String(i)} listed`, { duration: Infinity });
      }}
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Fire five' }));
    await findToast('Hearing 5 listed');
    await waitFor(() =>
      expect(document.querySelectorAll('[data-sonner-toast][data-visible="true"]')).toHaveLength(
        MAX_VISIBLE_TOASTS,
      ),
    );
  },
};

export const Hover: Story = {
  render: (args) => (
    <Demo
      {...args}
      fire={() => {
        toast('Draft saved', { duration: Infinity });
        toast('Hearing listed', { duration: Infinity });
      }}
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    const item = await findToast('Hearing listed');
    await userEvent.hover(item);
    await waitFor(() => expect(item).toHaveAttribute('data-expanded', 'true'));
  },
};

export const FocusVisible: Story = {
  render: (args) => <Demo {...args} fire={() => toast('Draft saved', { duration: Infinity })} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    await findToast('Draft saved');
    await userEvent.keyboard('{Alt>}t{/Alt}');
    await userEvent.tab();
    const focused = document.activeElement;
    await expect(focused?.closest('[data-sonner-toast]')).not.toBeNull();
    await expect(focused?.matches(':focus-visible')).toBe(true);
  },
};

export const Loading: Story = {
  render: (args) => (
    <Demo {...args} fire={() => toast.loading('Uploading vakalatnama', { duration: Infinity })} />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    const item = await findToast('Uploading vakalatnama');
    await expect(item.querySelector('[data-slot="spinner"]')).not.toBeNull();
  },
};

export const Invalid: Story = {
  render: (args) => (
    <Demo
      {...args}
      fire={() =>
        toast.error('Upload failed', {
          description: 'The file is larger than 25 MB.',
          duration: Infinity,
        })
      }
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    const item = await findToast('Upload failed');
    await expect(item.querySelector('[data-icon] svg')).not.toBeNull();
  },
};

export const WithIcon: Story = {
  render: (args) => (
    <Demo
      {...args}
      fire={() => {
        toast.success('Petition filed', { duration: Infinity });
        toast.info('Hearing moved to 14 Nov 2026', { duration: Infinity });
        toast.warning('Limitation ends in 3 days', { duration: Infinity });
      }}
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    await findToast('Limitation ends in 3 days');
  },
};

export const LongText: Story = {
  render: (args) => (
    <Demo
      {...args}
      fire={() => toast(LONG_LABEL, { description: MATTER_TITLE, duration: Infinity })}
    />
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    const item = await findToast(LONG_LABEL);
    await expect(item.getBoundingClientRect().width).toBeLessThanOrEqual(400);
  },
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl">
      <Demo
        {...args}
        dir="rtl"
        position="bottom-left"
        fire={() =>
          toast('Draft deleted', {
            duration: Infinity,
            action: { label: 'Undo', onClick: () => undefined },
          })
        }
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save draft' }));
    await findToast('Draft deleted');
  },
};

export const Tamil: Story = {
  render: (args) => (
    <div lang="ta">
      <Demo
        {...args}
        label={INDIC.ta.save}
        labels={{ close: INDIC.ta.close }}
        fire={() =>
          toast(INDIC.ta.saved, {
            duration: Infinity,
            action: { label: INDIC.ta.undo, onClick: () => undefined },
          })
        }
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: INDIC.ta.save }));
    await findToast(INDIC.ta.saved);
    await expect(
      within(toastRegion()).getByRole('button', { name: INDIC.ta.close }),
    ).toBeInTheDocument();
  },
};

export const Kannada: Story = {
  render: (args) => (
    <div lang="kn">
      <Demo
        {...args}
        label={INDIC.kn.save}
        labels={{ close: INDIC.kn.close }}
        fire={() =>
          toast(INDIC.kn.saved, {
            duration: Infinity,
            action: { label: INDIC.kn.undo, onClick: () => undefined },
          })
        }
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: INDIC.kn.save }));
    await findToast(INDIC.kn.saved);
    await expect(
      within(toastRegion()).getByRole('button', { name: INDIC.kn.close }),
    ).toBeInTheDocument();
  },
};
