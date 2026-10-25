// Stories for the status components. apps/site has no Storybook runner yet (K3), so `Meta` is a
// local minimal type; a runner can adopt these files unchanged. Dark mode: use the `dark` class.
import type { ReactNode } from 'react';

import type { StatusSnapshot } from '../../lib/status/model.ts';

import { ComponentRow } from './component-row.tsx';
import { IncidentList } from './incident-list.tsx';
import { OverallBanner } from './overall-banner.tsx';
import { StatusView, type StatusViewState } from './status-view.tsx';
import { SubscribeLinks } from './subscribe-links.tsx';
import { UptimeStrip } from './uptime-strip.tsx';

interface Meta {
  title: string;
  decorators?: ((Story: () => ReactNode) => ReactNode)[];
}

const NOW = new Date('2026-10-25T10:00:00.000Z');
const SIG = { alg: 'HS256' as const, value: '0'.repeat(64) };
const incident: StatusSnapshot['incidents'][number] = {
  id: '3f9c1c1e-6a49-4d0e-8a77-0c5f0d6a1b11',
  title: 'Slow document parsing',
  severity: 'degraded',
  state: 'monitoring',
  component: 'court',
  startedAt: '2026-10-25T08:00:00.000Z',
  resolvedAt: null,
  updates: [{ state: 'monitoring', body: 'A fix is in place.', at: '2026-10-25T09:00:00.000Z' }],
};
const snapshot = (
  overall: StatusSnapshot['overall'],
  incidents: StatusSnapshot['incidents'] = [],
): StatusSnapshot => ({
  version: 1,
  generatedAt: NOW.toISOString(),
  overall,
  components: [
    { id: 'database', name: 'Database', status: 'operational' },
    { id: 'storage', name: 'Storage', status: 'operational' },
    { id: 'court', name: 'Court', status: overall },
  ],
  incidents,
  signature: SIG,
});

const withTheme =
  (theme: 'light' | 'dark') =>
  (Story: () => ReactNode): ReactNode => (
    <div className={theme === 'dark' ? 'dark bg-surface p-4' : 'bg-surface p-4'}>{Story()}</div>
  );

export default {
  title: 'Site/Status',
  decorators: [withTheme('light')],
} satisfies Meta;

export const Banner = () => <OverallBanner overall="degraded" />;
export const BannerDark = () => withTheme('dark')(() => <OverallBanner overall="down" />);
export const Row = () => (
  <ul>
    <ComponentRow id="court" status="down" />
  </ul>
);
export const Strip = () => <UptimeStrip incidents={[incident]} now={NOW} />;
export const Incidents = () => <IncidentList incidents={[incident]} />;
export const Subscribe = () => <SubscribeLinks />;

const view = (state: StatusViewState, online = true) => (
  <StatusView state={state} online={online} now={NOW} />
);
export const Operational = () => view({ kind: 'empty', snapshot: snapshot('operational') });
export const Degraded = () => view({ kind: 'ok', snapshot: snapshot('degraded', [incident]) });
export const Down = () => view({ kind: 'ok', snapshot: snapshot('down', [incident]) });
export const Stale = () => view({ kind: 'stale', snapshot: snapshot('operational'), ageSec: 900 });
export const Unverified = () => view({ kind: 'unverified' });
export const Unavailable = () => view({ kind: 'unavailable' });
export const Skeleton = () => view({ kind: 'loading' });
export const Offline = () => view({ kind: 'empty', snapshot: snapshot('operational') }, false);
