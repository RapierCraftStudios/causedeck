// Regression guard (#271): VAPID test keys are generated at runtime, never committed. A P-256
// public key literal is the uncompressed point (65 bytes: 87 URL-safe base64 chars starting `B`);
// a private key literal is 32 bytes (43 chars). Gitleaks only allowlists the historical commit.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.join(import.meta.dirname, '../../..');
const FILES = [
  'e2e/support/server-pool.ts',
  'apps/web/components/notifications/__tests__/push-permission-card.test.tsx',
];
const KEY_LITERAL = /['"`](?:B[A-Za-z0-9_-]{86}|[A-Za-z0-9_-]{43})['"`]/g;

describe('VAPID test keys', () => {
  it.each(FILES)('%s commits no VAPID key literal', (file) => {
    const text = readFileSync(path.join(repoRoot, file), 'utf8');
    expect(text.match(KEY_LITERAL) ?? []).toEqual([]);
  });
});
