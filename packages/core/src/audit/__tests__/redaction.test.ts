// The audit privacy guards (#227, #26 part 2): metadata never carries privileged content, the user
// agent is hashed, and IPs are truncated for display.
import { createHash, randomUUID } from 'node:crypto';

import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import {
  assertRedacted,
  AUDIT_BANNED_METADATA_KEYS,
  AuditRedactionError,
  hashUserAgent,
  record,
  truncateIpForDisplay,
} from '../index.ts';

describe('redaction guard', () => {
  it.each(['content', 'text', 'quote', 'Content', 'TEXT', 'Quote', 'body', 'prompt', 'transcript'])(
    'record() rejects metadata key %s and writes nothing, even for informational actions',
    async (key) => {
      await withTestDb(async (tx) => {
        const workspaceId = randomUUID();
        for (const action of ['member.removed', 'workspace.settings_viewed'] as const) {
          await expect(
            record(
              { db: tx, workspaceId, actor: { userId: null, kind: 'system' } },
              { action, metadata: { [key]: 'Para 12: the witness stated...' } },
            ),
          ).rejects.toBeInstanceOf(AuditRedactionError);
        }
        const rows = await inWorkspace(tx, workspaceId, (s) => s.select().from(schema.auditEvent));
        expect(rows).toHaveLength(0);
      });
    },
  );

  it('bans at least content, text and quote', () => {
    expect(AUDIT_BANNED_METADATA_KEYS).toEqual(
      expect.arrayContaining(['content', 'text', 'quote']),
    );
  });

  it('allows flat id-only metadata', () => {
    expect(() => {
      assertRedacted({ matterId: 'mat-1', count: 2, confirmed: true, reassignedTo: null });
    }).not.toThrow();
    expect(() => {
      assertRedacted(undefined);
    }).not.toThrow();
  });

  it('rejects nested values, which could smuggle content past the key check', () => {
    expect(() => {
      assertRedacted({ details: { content: 'x' } });
    }).toThrow(AuditRedactionError);
    expect(() => {
      assertRedacted({ ids: ['a', 'b'] });
    }).toThrow(AuditRedactionError);
  });
});

describe('hashUserAgent', () => {
  it('is the sha256 hex of the user agent, null when absent', () => {
    expect(hashUserAgent('Agent/1.0')).toBe(createHash('sha256').update('Agent/1.0').digest('hex'));
    expect(hashUserAgent(undefined)).toBeNull();
    expect(hashUserAgent('')).toBeNull();
  });
});

describe('truncateIpForDisplay', () => {
  it('shows IPv4 as its /24', () => {
    expect(truncateIpForDisplay('203.0.113.77')).toBe('203.0.113.0/24');
  });

  it('shows IPv6 as its /48', () => {
    expect(truncateIpForDisplay('2001:db8:abcd:12:1::7')).toBe('2001:db8:abcd::/48');
    expect(truncateIpForDisplay('2001:db8::1')).toBe('2001:db8:0::/48');
  });

  it('returns null for a missing or invalid address', () => {
    expect(truncateIpForDisplay(null)).toBeNull();
    expect(truncateIpForDisplay(undefined)).toBeNull();
    expect(truncateIpForDisplay('not-an-ip')).toBeNull();
  });
});
