'use client';

import { Alert, AlertDescription, AlertTitle } from '@causedeck/ui/alert';
import { useCallback, useEffect, useState } from 'react';

import { loadStatus, watchOnline, type StatusState } from '../../lib/status/state.ts';

import { ComponentRow } from './component-row.tsx';
import { IncidentList } from './incident-list.tsx';
import { OverallBanner } from './overall-banner.tsx';
import { SubscribeLinks } from './subscribe-links.tsx';
import { UptimeStrip } from './uptime-strip.tsx';

export type StatusViewState = StatusState | { kind: 'loading' };

interface Props {
  /** Where `status.json` is fetched from and the key it is verified with. The pages pass them from
   * the build env: importing `lib/env.ts` here would put zod in the client bundle. */
  statusUrl?: string;
  verifyKey?: string;
  /** `current` shows live components and open incidents; `history` the resolved ones. */
  mode?: 'current' | 'history';
  /** Fixed state for stories and tests; skips the fetch. */
  state?: StatusViewState;
  online?: boolean;
  now?: Date;
}

export function StatusView({
  statusUrl = '/status/status.json',
  verifyKey = '',
  mode = 'current',
  state: fixed,
  online: fixedOnline,
  now,
}: Props) {
  const [loaded, setLoaded] = useState<StatusViewState>({ kind: 'loading' });
  const [online, setOnline] = useState(true);
  const fetchStatus = useCallback(
    () => loadStatus((url, init) => fetch(url, init), statusUrl, verifyKey, new Date()),
    [statusUrl, verifyKey],
  );
  const retry = useCallback(() => {
    setLoaded({ kind: 'loading' });
    void fetchStatus().then(setLoaded);
  }, [fetchStatus]);

  useEffect(() => {
    if (fixed === undefined) void fetchStatus().then(setLoaded);
  }, [fixed, fetchStatus]);
  useEffect(() => {
    return watchOnline(window, setOnline);
  }, []);

  const state = fixed ?? loaded;
  const isOnline = fixedOnline ?? online;
  const at = now ?? new Date();

  return (
    <div className="space-y-6">
      {isOnline ? null : (
        <Alert tone="warning">
          <AlertTitle>You are offline</AlertTitle>
          <AlertDescription>The status shown may be out of date.</AlertDescription>
        </Alert>
      )}
      <div aria-live="polite" aria-atomic="true">
        {renderState(state, mode, at, retry)}
      </div>
    </div>
  );
}

function renderState(
  state: StatusViewState,
  mode: 'current' | 'history',
  now: Date,
  retry: () => void,
) {
  switch (state.kind) {
    case 'loading':
      return (
        // Reserves about the height of the loaded page so the footer does not jump (CLS).
        <div
          aria-busy="true"
          role="status"
          className={`space-y-3 ${mode === 'history' ? 'min-h-40' : 'min-h-[27rem]'}`}
        >
          <span className="sr-only">Loading status</span>
          <div className="bg-surface-sunken h-16 rounded-md" />
          <div className="bg-surface-sunken h-36 rounded-md" />
        </div>
      );
    case 'unavailable':
      return (
        <Alert
          tone="danger"
          action={
            <button type="button" className="cd-link text-sm font-medium" onClick={retry}>
              Status unavailable, retry
            </button>
          }
        >
          <AlertTitle>Status unavailable</AlertTitle>
          <AlertDescription>We could not load the status data.</AlertDescription>
        </Alert>
      );
    case 'unverified':
      return (
        <Alert tone="danger">
          <AlertTitle>Status data could not be verified</AlertTitle>
          <AlertDescription>
            The data was not shown because its signature did not match.
          </AlertDescription>
        </Alert>
      );
    default: {
      const { snapshot } = state;
      const resolved = snapshot.incidents.filter((i) => i.resolvedAt !== null);
      const open = snapshot.incidents.filter((i) => i.resolvedAt === null);
      return (
        <div className="space-y-8">
          {state.kind === 'stale' ? (
            <Alert tone="warning">
              <AlertTitle>This status may be out of date</AlertTitle>
              <AlertDescription>It was last updated more than 5 minutes ago.</AlertDescription>
            </Alert>
          ) : null}
          {mode === 'history' ? (
            <section aria-labelledby="history-heading">
              <h2 id="history-heading" className="text-ink mb-3 text-base font-semibold">
                Resolved incidents
              </h2>
              <IncidentList
                incidents={resolved}
                emptyText="No resolved incidents in the last 30 days."
              />
            </section>
          ) : (
            <>
              <OverallBanner overall={snapshot.overall} />
              <ul>
                {snapshot.components.map((c) => (
                  <ComponentRow key={c.id} id={c.id} status={c.status} />
                ))}
              </ul>
              <UptimeStrip incidents={snapshot.incidents} now={now} />
              {open.length > 0 ? (
                <section aria-labelledby="open-heading">
                  <h2 id="open-heading" className="text-ink mb-3 text-base font-semibold">
                    Current incidents
                  </h2>
                  <IncidentList incidents={open} />
                </section>
              ) : null}
              <SubscribeLinks />
            </>
          )}
        </div>
      );
    }
  }
}
