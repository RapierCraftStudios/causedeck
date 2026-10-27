// check-stories: n/a Hover, FocusVisible, Active, Disabled, Loading, Invalid (inline text run; the card is opened by defaultOpen)
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { FACT_STATUS_ORDER, FactSquiggle } from './fact-squiggle';

const SOURCE = {
  document: 'Order.pdf',
  page: 3,
  quote: 'The matter is listed on 12 March 2024 before Court Hall 4.',
  highlight: { start: 22, end: 35 },
};

const meta = {
  title: 'Patterns/FactSquiggle',
  component: FactSquiggle,
  args: { status: 'mismatch', children: '14 March 2024', source: SOURCE, presentation: 'popover' },
  argTypes: { status: { control: 'select', options: FACT_STATUS_ORDER } },
} satisfies Meta<typeof FactSquiggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /14 March 2024/ })).toHaveAttribute(
      'data-status',
      'mismatch',
    );
  },
};

export const WithIcon: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.ownerDocument.querySelector('[data-slot="fact-card"] svg'),
    ).not.toBeNull();
  },
};

export const AllFactStatuses: Story = {
  render: (args) => (
    <p className="max-w-xl leading-8">
      {FACT_STATUS_ORDER.map((status) => (
        <span key={status} className="me-4">
          <FactSquiggle {...args} status={status}>
            {status}
          </FactSquiggle>
        </span>
      ))}
    </p>
  ),
};

export const Dark: Story = {
  args: { defaultOpen: true },
  decorators: [
    (Story) => (
      <div data-theme="dark" className="dark bg-surface p-6">
        <Story />
      </div>
    ),
  ],
};

export const FactCardSheet: Story = {
  args: { presentation: 'sheet', defaultOpen: true },
};

export const LongText: Story = {
  args: {
    children: 'Writ Petition (MD) No. 12345 of 2024 filed before the Madurai Bench',
    defaultOpen: true,
  },
  decorators: [
    (Story) => (
      <div className="max-w-60">
        <Story />
      </div>
    ),
  ],
};

export const RtlNeutral: Story = {
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
};

export const Tamil: Story = {
  args: {
    status: 'unsupported',
    children: '12 மார்ச் 2024',
    defaultOpen: true,
    source: {
      document: 'ஆணை.pdf',
      page: 2,
      quote: 'வழக்கு 12 மார்ச் 2024 அன்று பட்டியலிடப்பட்டது.',
    },
    labels: {
      status: {
        match: 'பதிவுடன் பொருந்துகிறது',
        mismatch: 'பதிவுடன் பொருந்தவில்லை',
        unsupported: 'பதிவில் இல்லை',
        'unverified-citation': 'மேற்கோள் சரிபார்க்கப்படவில்லை',
        ambiguous: 'பதிவில் தெளிவற்றது',
      },
      source: 'பதிவிலிருந்து',
      fix: 'சரிசெய்',
      ignore: 'புறக்கணி',
      ignoreForMatter: 'இந்த வழக்கிற்குப் புறக்கணி',
      markAssertion: 'என் கூற்றாகக் குறி',
      page: (page) => `பக்கம் ${String(page)}`,
    },
    onFix: () => undefined,
    onIgnore: () => undefined,
    onIgnoreForMatter: () => undefined,
    onMarkAssertion: () => undefined,
  },
  decorators: [
    (Story) => (
      <div lang="ta">
        <Story />
      </div>
    ),
  ],
};

export const Kannada: Story = {
  args: {
    status: 'mismatch',
    children: '12 ಮಾರ್ಚ್ 2024',
    defaultOpen: true,
    source: {
      document: 'ಆದೇಶ.pdf',
      page: 2,
      quote: 'ಪ್ರಕರಣವನ್ನು 12 ಮಾರ್ಚ್ 2024 ರಂದು ಪಟ್ಟಿ ಮಾಡಲಾಗಿದೆ.',
    },
    labels: {
      status: {
        match: 'ದಾಖಲೆಗೆ ಹೊಂದುತ್ತದೆ',
        mismatch: 'ದಾಖಲೆಗೆ ಹೊಂದುವುದಿಲ್ಲ',
        unsupported: 'ದಾಖಲೆಯಲ್ಲಿ ಇಲ್ಲ',
        'unverified-citation': 'ಉಲ್ಲೇಖವನ್ನು ಪರಿಶೀಲಿಸಿಲ್ಲ',
        ambiguous: 'ದಾಖಲೆಯಲ್ಲಿ ಅಸ್ಪಷ್ಟ',
      },
      source: 'ದಾಖಲೆಯಿಂದ',
      fix: 'ಸರಿಪಡಿಸಿ',
      ignore: 'ನಿರ್ಲಕ್ಷಿಸಿ',
      ignoreForMatter: 'ಈ ಪ್ರಕರಣಕ್ಕೆ ನಿರ್ಲಕ್ಷಿಸಿ',
      markAssertion: 'ನನ್ನ ಪ್ರತಿಪಾದನೆ ಎಂದು ಗುರುತಿಸಿ',
      page: (page) => `ಪುಟ ${String(page)}`,
    },
    onFix: () => undefined,
    onIgnore: () => undefined,
    onIgnoreForMatter: () => undefined,
    onMarkAssertion: () => undefined,
  },
  decorators: [
    (Story) => (
      <div lang="kn">
        <Story />
      </div>
    ),
  ],
};
