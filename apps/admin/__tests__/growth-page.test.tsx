// The Growth page (#509): weekly cohort funnel with step conversion, time to first court-day view,
// the channel filter and the empty state. The data layer is mocked; its read is covered in core.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ growthFunnel: vi.fn() }));

vi.mock('../lib/data/index.ts', async () => {
  const steps = [
    'signed_up',
    'workspace_created',
    'identifiers_entered',
    'discovery_found',
    'confirm_grid_done',
    'first_court_day_view',
    'first_alert',
    'first_brief',
    'whatsapp_linked',
    'invite_sent',
  ];
  return {
    ACTIVATION_STEPS: steps,
    ACTIVATION_CHANNELS: ['direct', 'invite', 'whatsapp', 'search', 'social', 'referral', 'other'],
    growthFunnel: state.growthFunnel,
  };
});
vi.mock('../lib/staff.ts', () => ({
  requireStaff: vi.fn(() => Promise.resolve({ userId: 'staff', role: 'ops' })),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

const { default: GrowthPage } = await import('../app/(console)/growth/page.tsx');
const { requireStaff } = await import('../lib/staff.ts');

const STEPS = [
  'signed_up',
  'workspace_created',
  'identifiers_entered',
  'discovery_found',
  'confirm_grid_done',
  'first_court_day_view',
  'first_alert',
  'first_brief',
  'whatsapp_linked',
  'invite_sent',
];

function funnel() {
  return {
    cohorts: [
      {
        week: '2031-03-03',
        signedUp: 4,
        steps: STEPS.map((step) => ({
          step,
          users: step === 'signed_up' ? 4 : step === 'first_court_day_view' ? 2 : 0,
          conversion: step === 'signed_up' ? 1 : step === 'first_court_day_view' ? 0.5 : 0,
        })),
      },
    ],
    timeToFirstCourtDay: [
      { week: '2031-03-03', reached: 2, medianSeconds: 5 * 3600, p90Seconds: 26 * 3600 },
    ],
  };
}

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await GrowthPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  state.growthFunnel.mockReset();
  state.growthFunnel.mockResolvedValue(funnel());
});

describe('GrowthPage', () => {
  it('requires the growth capability', async () => {
    await render();
    expect(requireStaff).toHaveBeenCalledWith('growth');
  });

  it('shows step conversion by weekly cohort and the time to first court-day view', async () => {
    const html = await render();
    expect(html).toContain('2031-03-03');
    expect(html).toContain('2 (50%)');
    expect(html).toContain('5h 0m / 1d 2h');
    expect(html).toContain('First court-day view');
    expect(html).toContain('Time to first court-day view (median / p90)');
  });

  it('passes a known channel to the read and ignores an unknown one', async () => {
    await render({ channel: 'whatsapp' });
    expect(state.growthFunnel).toHaveBeenLastCalledWith(expect.anything(), { channel: 'whatsapp' });
    await render({ channel: 'a@b.in' });
    expect(state.growthFunnel).toHaveBeenLastCalledWith(expect.anything(), { channel: undefined });
  });

  it('renders an empty state and a dash when nobody has reached the court-day view', async () => {
    state.growthFunnel.mockResolvedValue({ cohorts: [], timeToFirstCourtDay: [] });
    expect(await render()).toContain('No sign-ups yet.');
    const f = funnel();
    f.timeToFirstCourtDay = [];
    state.growthFunnel.mockResolvedValue(f);
    expect(await render()).toContain('- / -');
  });

  it('renders no email or user id', async () => {
    expect(await render()).not.toMatch(/@|user_?id/i);
  });
});
