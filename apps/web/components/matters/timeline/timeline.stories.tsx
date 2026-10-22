// Matter timeline (#41): Combined (the default) and Lanes, a filtered view, the empty, loading,
// error and offline states, a 1,000-event matter (virtualised), a proposed event with its
// `To confirm` pill, and Tamil and Kannada party names inside event text (Noto fallback, line
// height).
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import TimelineError from '../../../app/(app)/w/[slug]/matters/[id]/timeline/error.tsx';
import TimelineLoading from '../../../app/(app)/w/[slug]/matters/[id]/timeline/loading.tsx';
import type {
  GraphNodeView,
  TimelineEventView,
  TimelineView,
} from '../../../lib/matters/timeline.ts';
import { TIMELINE_KINDS } from '../../../lib/matters/timeline-tab.ts';
import { MattersPermissionDenied } from '../matters-list.tsx';

import { TimelineWorkspace } from './timeline.tsx';

const WP = '00000000-0000-4000-8000-0000000e0001';
const WA = '00000000-0000-4000-8000-0000000e0002';
const MATTER = '00000000-0000-4000-8000-0000000a1001';

const nodes: GraphNodeView[] = [
  {
    id: WP,
    parentId: null,
    label: 'W.P. 678/2026',
    caseType: 'W.P.',
    caseNumber: { number: '678', year: 2026 },
    unnumbered: false,
    srFrNo: null,
    forum: 'Madras HC',
    state: 'numbered',
    relations: [{ kind: 'appeal_from', direction: 'to', label: 'W.A. 12/2026' }],
  },
  {
    id: WA,
    parentId: null,
    label: 'W.A. 12/2026',
    caseType: 'W.A.',
    caseNumber: { number: '12', year: 2026 },
    unnumbered: false,
    srFrNo: null,
    forum: 'Madras HC',
    state: 'numbered',
    relations: [{ kind: 'appeal_from', direction: 'from', label: 'W.P. 678/2026' }],
  },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const event = (
  n: number,
  over: Partial<TimelineEventView> & Pick<TimelineEventView, 'date' | 'kind'>,
): TimelineEventView => {
  const month = over.date.slice(0, 7);
  const [year, mm, dd] = over.date.split('-');
  const text = `${dd ?? ''} ${MONTHS[Number(mm) - 1] ?? ''} ${year ?? ''}`;
  return {
    id: `${over.kind}:E${String(n)}`,
    dateText: text,
    monthKey: month,
    monthText: text.split(' ').slice(1).join(' '),
    future: over.date > '2026-10-22',
    proposed: false,
    proceedingId: n % 2 === 0 ? WA : WP,
    proceedingLabel: n % 2 === 0 ? 'W.A. 12/2026' : 'W.P. 678/2026',
    subject: null,
    qualifier: null,
    fromState: null,
    toState: null,
    searchText: '',
    source: { kind: 'document', label: 'Document', state: 'confirmed' },
    anchor: null,
    openSourceHref: null,
    ...over,
  };
};

const BASE_EVENTS: TimelineEventView[] = [
  event(1, {
    kind: 'state_change',
    date: '2026-07-14',
    fromState: 'filed',
    toState: 'numbered',
    subject: 'Numbered by the registry',
    source: { kind: 'system', label: 'System', state: 'confirmed' },
  }),
  event(2, {
    kind: 'order',
    date: '2026-08-21',
    qualifier: 'interim',
    source: { kind: 'document', label: 'Document', state: 'confirmed', page: 3, confidence: 0.92 },
    anchor: {
      id: 'a1',
      documentTitle: 'Order',
      quote: 'Interim stay granted till the next date of hearing.',
      page: 3,
    },
    openSourceHref: `/w/chennai-solo/matters/${MATTER}/documents?doc=d1&page=3`,
  }),
  event(3, {
    kind: 'hearing',
    date: '2026-09-18',
    subject: 'Adjourned at the request of the respondent',
    proposed: true,
    source: { kind: 'ai', label: 'AI reading', state: 'proposed', confidence: 0.74 },
  }),
  event(4, {
    kind: 'obligation_due',
    date: '2026-10-30',
    subject: 'File the counter affidavit',
    source: { kind: 'manual', label: 'Entered by you', state: 'confirmed' },
  }),
  event(5, {
    kind: 'listing',
    date: '2026-11-12',
    subject: 'For hearing',
    qualifier: 'daily',
    source: { kind: 'adapter', label: 'Court website', state: 'confirmed' },
  }),
  event(6, {
    kind: 'bench_change',
    date: '2026-06-02',
    source: { kind: 'adapter', label: 'Court website', state: 'confirmed' },
  }),
];

const sorted = (list: TimelineEventView[]) =>
  [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const view: TimelineView = {
  events: sorted(BASE_EVENTS),
  nodes,
  edges: [{ id: 'l1', from: WA, to: WP, kind: 'appeal_from' }],
  groups: [],
  kinds: [...TIMELINE_KINDS],
};

const many = (count: number): TimelineEventView[] =>
  sorted(
    Array.from({ length: count }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, '0');
      const month = String((Math.floor(i / 28) % 12) + 1).padStart(2, '0');
      return event(i + 100, {
        kind: 'document_added',
        date: `2025-${month}-${day}`,
        qualifier: 'pleading',
        source: { kind: 'capture', label: 'Capture', state: 'confirmed' },
      });
    }),
  );

const meta = {
  title: 'Matters/Timeline/Timeline',
  component: TimelineWorkspace,
  args: { view, search: '', todayText: '22 Oct 2026' },
} satisfies Meta<typeof TimelineWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Combined: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('group', { name: 'Events across all proceedings' }),
    ).toBeVisible();
    await expect(canvas.getByText('To confirm')).toBeVisible();
    await expect(canvas.getByText('Jump to today')).toBeVisible();
  },
};

export const Lanes: Story = {
  args: { search: 'mode=lanes' },
};

export const Filtered: Story = {
  args: { search: `p=${WA}&k=hearing,obligation_due` },
};

export const FilteredEmpty: Story = {
  args: { search: 'q=nothing%20matches%20this' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No events match these filters.')).toBeVisible();
  },
};

export const Empty: Story = {
  args: { view: { ...view, events: [] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing has happened on this matter yet.')).toBeVisible();
  },
};

export const Offline: Story = {
  args: { forcedOffline: true, savedAt: new Date('2026-10-22T08:30:00Z') },
};

export const Loading: Story = {
  render: () => <TimelineLoading />,
};

export const ErrorState: Story = {
  render: () => (
    <TimelineError
      error={Object.assign(new Error('x'), { digest: 'ref-41' })}
      reset={() => undefined}
    />
  ),
};

export const PermissionDenied: Story = {
  render: () => <MattersPermissionDenied />,
};

export const LargeThousandEvents: Story = {
  args: { view: { ...view, events: many(1000) } },
};

export const Tamil: Story = {
  args: {
    view: {
      ...view,
      events: sorted([
        event(7, {
          kind: 'hearing',
          date: '2026-09-18',
          subject: 'மீனா ஐயர் எதிர் தமிழ்நாடு அரசு — வழக்கு ஒத்திவைக்கப்பட்டது',
        }),
        ...BASE_EVENTS.slice(0, 2),
      ]),
    },
  },
  globals: { locale: 'ta' },
};

export const Kannada: Story = {
  args: {
    view: {
      ...view,
      events: sorted([
        event(8, {
          kind: 'hearing',
          date: '2026-09-18',
          subject: 'ಮೀನಾ ಅಯ್ಯರ್ ವಿರುದ್ಧ ಕರ್ನಾಟಕ ಸರ್ಕಾರ — ಪ್ರಕರಣ ಮುಂದೂಡಲಾಗಿದೆ',
        }),
        ...BASE_EVENTS.slice(0, 2),
      ]),
    },
  },
  globals: { locale: 'kn' },
};
