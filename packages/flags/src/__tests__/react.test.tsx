// The client mirror renders server-evaluated booleans and nothing else (#22): no rows, notes or
// staff metadata reach the client tree.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { defaultSnapshot, type FlagKey, type FlagSnapshot } from '../keys.ts';
import {
  Feature,
  FlagsProvider,
  sanitizeSnapshot,
  useFlag,
  useIsEnabled,
  type FlagsProviderProps,
} from '../react.tsx';

const snapshot = (on: FlagKey[]): FlagSnapshot => ({
  ...defaultSnapshot(),
  ...Object.fromEntries(on.map((key) => [key, true])),
});

function Probe({ flag }: { flag: FlagKey }) {
  const isEnabled = useIsEnabled();
  return <i data-flag={flag}>{`${String(useFlag(flag))}/${String(isEnabled(flag))}`}</i>;
}

describe('FlagsProvider, useFlag and <Feature>', () => {
  it('reflect the server-evaluated snapshot', () => {
    const html = renderToStaticMarkup(
      <FlagsProvider flags={snapshot(['insights.enabled'])}>
        <Feature flag="insights.enabled">insights-on</Feature>
        <Feature flag="invoices.enabled" fallback="invoices-off">
          invoices-on
        </Feature>
        <Probe flag="insights.enabled" />
        <Probe flag="pwa.offline" />
      </FlagsProvider>,
    );
    expect(html).toContain('insights-on');
    expect(html).toContain('invoices-off');
    expect(html).not.toContain('invoices-on');
    expect(html).toContain('<i data-flag="insights.enabled">true/true</i>');
    expect(html).toContain('<i data-flag="pwa.offline">false/false</i>');
  });

  it('is off without a provider', () => {
    expect(renderToStaticMarkup(<Probe flag="insights.enabled" />)).toContain('false/false');
    expect(renderToStaticMarkup(<Feature flag="insights.enabled">x</Feature>)).toBe('');
  });

  it('accepts only booleans and drops anything else a caller smuggles in', () => {
    expectTypeOf<FlagsProviderProps['flags']>().toEqualTypeOf<FlagSnapshot>();
    expectTypeOf<FlagSnapshot[FlagKey]>().toEqualTypeOf<boolean>();
    const leaky = {
      ...snapshot(['invoices.enabled']),
      legalAckNote: 'Counsel memo, privileged',
      legal_ack_by: '00000000-0000-4000-8000-000000000001',
      'limitation.enabled': { enabled: true, legalAckNote: 'secret' },
    } as unknown as FlagSnapshot;
    const clean = sanitizeSnapshot(leaky);
    expect(JSON.stringify(clean)).not.toMatch(/Counsel|secret|legal/i);
    expect(clean['invoices.enabled']).toBe(true);
    expect(clean['limitation.enabled']).toBeUndefined();
    expect(Object.values(clean).every((v) => typeof v === 'boolean')).toBe(true);
  });
});
