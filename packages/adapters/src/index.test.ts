import { describe, expect, it } from 'vitest';

import * as adapters from './index.ts';

describe('@causedeck/adapters', () => {
  it('exports its package name', () => {
    expect(adapters.packageName).toBe('@causedeck/adapters');
  });

  it('exports the framework core (#369)', () => {
    for (const name of [
      'AdapterConfigSchema',
      'AccessModeViolationError',
      'assertAccessMode',
      'buildListUnreadable',
      'createEchoAdapter',
      'listAdapters',
      'matchKey',
      'normaliseCaseNumber',
      'normaliseCaseType',
      'normaliseDate',
      'normaliseNeutralCitation',
      'normaliseStage',
      'ParsedCauseListSchema',
      'register',
      'resolveByForum',
      'resolveById',
    ] as const) {
      expect(adapters[name], name).toBeDefined();
    }
  });

  it('exports the layout readers (#370)', () => {
    for (const name of ['layoutFromHtml', 'layoutFromPdf', 'layoutFromText'] as const) {
      expect(adapters[name], name).toBeTypeOf('function');
    }
  });

  it('exports the pure config checksums and parse-health monitor (#372)', () => {
    for (const name of [
      'canonicalJson',
      'configChecksum',
      'ECHO_BUNDLED',
      'evaluateParseHealth',
      'parseRunMetrics',
      'PARSE_HEALTH_FLAGS',
      'PARSE_HEALTH_THRESHOLDS',
      'sha256Hex',
    ] as const) {
      expect(adapters[name], name).toBeDefined();
    }
  });

  it('keeps the database and filesystem parts off the entry (#372)', () => {
    for (const name of [
      'activateAdapterVersion',
      'createAdapterConfigLoader',
      'fixturesDigest',
      'recordParseRun',
    ]) {
      expect(name in adapters, name).toBe(false);
    }
  });
});
