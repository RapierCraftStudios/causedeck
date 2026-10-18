// check-stories: n/a Hover, FocusVisible, Active, Disabled, Invalid (a static shell; its actions are Buttons with their own states)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FolderOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';

import { Button } from '../button/button';
import { INDIC, LONG_LABEL } from '../__fixtures__/labels';
import { EmptyState } from './empty-state';

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
  args: {
    title: 'No matters yet',
    description: 'Add your first matter to start tracking hearings.',
  },
  decorators: [
    (Story) => (
      <div className="border-line w-112 rounded-lg border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    function Demo() {
      const [opened, setOpened] = useState(false);
      return (
        <EmptyState
          {...args}
          action={
            <Button
              onClick={() => {
                setOpened(true);
              }}
            >
              {opened ? 'Opening' : 'Add matter'}
            </Button>
          }
        />
      );
    }
    return <Demo />;
  },
  play: async ({ canvas, canvasElement }) => {
    // Illustration-free: no images.
    await expect(canvasElement.querySelector('img')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Add matter' }));
    await expect(canvas.getByRole('button', { name: 'Opening' })).toBeInTheDocument();
  },
};

export const Loading: Story = {
  render: (args) => <EmptyState {...args} action={<Button loading>Add matter</Button>} />,
};

export const WithIcon: Story = {
  render: (args) => (
    <EmptyState
      {...args}
      icon={<FolderOpen />}
      title="No documents"
      description="Upload pleadings or orders to this matter."
      action={
        <Button>
          <Plus aria-hidden="true" />
          Upload
        </Button>
      }
      secondaryAction={<Button variant="ghost">Learn more</Button>}
    />
  ),
};

export const LongText: Story = {
  render: (args) => (
    <EmptyState
      {...args}
      title={LONG_LABEL}
      description={LONG_LABEL}
      action={<Button>Add matter</Button>}
    />
  ),
};

export const RtlNeutral: Story = {
  render: (args) => (
    <div dir="rtl">
      <EmptyState {...args} icon={<FolderOpen />} action={<Button>Add matter</Button>} />
    </div>
  ),
};

export const Tamil: Story = {
  render: () => (
    <div lang="ta">
      <EmptyState
        title={INDIC.ta.noMatters}
        description={INDIC.ta.noMattersBody}
        action={<Button>{INDIC.ta.addMatter}</Button>}
      />
    </div>
  ),
};

export const Kannada: Story = {
  render: () => (
    <div lang="kn">
      <EmptyState
        title={INDIC.kn.noMatters}
        description={INDIC.kn.noMattersBody}
        action={<Button>{INDIC.kn.addMatter}</Button>}
      />
    </div>
  ),
};
