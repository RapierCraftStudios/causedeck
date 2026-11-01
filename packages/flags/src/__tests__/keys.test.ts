import { FLAG_KILL_SWITCHES } from '@causedeck/config/env';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  defaultSnapshot,
  FLAG_KEYS,
  FLAGS,
  getFlag,
  isFlagKey,
  killSwitchEnvFor,
  packageName,
  UnknownFlagError,
  type FlagKey,
} from '../index.ts';

const LEGAL = [
  'invoices.enabled',
  'limitation.enabled',
  'court.a2.retrieval',
  'court.live-tracking',
  'court.khc-a2',
  'court.case-status',
  'court.sanctioned-push',
  'capture.whatsapp-import',
  'conflicts.check',
  'intake.enquiry_log',
  'status_links.enabled',
  'bench_facts',
  'captcha.bulk',
];

describe('flag registry', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@causedeck/flags');
  });

  it('registers exactly the launch flags, all off by default, the court/invoice/limitation ones legal-gated', () => {
    expect([...FLAG_KEYS].sort()).toEqual(
      [
        ...LEGAL,
        'ai.bedrock',
        'ai.sarvam',
        'capture.email-forward',
        'capture.ics-feed',
        'pwa.offline',
        'billing.razorpay',
        'insights.enabled',
        'workspace.export',
        'm5_playbooks',
        'adapters.workbench-fetch',
        'growth.onboarding-nudge',
        'growth.free-alerts',
      ].sort(),
    );
    for (const key of FLAG_KEYS) {
      const def = FLAGS[key];
      expect(def.key).toBe(key);
      expect(def.default).toBe(false);
      expect(def.legalGated, key).toBe(LEGAL.includes(key));
      expect(def.owner.length, key).toBeGreaterThan(0);
    }
    expect(Object.values(defaultSnapshot()).every((v) => !v)).toBe(true);
  });

  it('derives the kill-switch name and keeps the config declaration in sync', () => {
    expect(killSwitchEnvFor('invoices.enabled')).toBe('KILL_INVOICES_ENABLED');
    expect(FLAGS['court.live-tracking'].killSwitchEnv).toBe('KILL_COURT_LIVE_TRACKING');
    expect(FLAG_KEYS.map((k) => FLAGS[k].killSwitchEnv).sort()).toEqual(
      [...FLAG_KILL_SWITCHES].sort(),
    );
  });

  it('rejects an unknown key at compile time and at runtime', () => {
    expectTypeOf<'invoices.enabled'>().toExtend<FlagKey>();
    expectTypeOf<'invoices.enable'>().not.toExtend<FlagKey>();
    // @ts-expect-error unknown flag keys do not compile
    expect(() => getFlag('nope.enabled')).toThrow(UnknownFlagError);
    expect(isFlagKey('nope.enabled')).toBe(false);
    expect(isFlagKey('toString')).toBe(false);
    expect(isFlagKey('pwa.offline')).toBe(true);
  });
});
