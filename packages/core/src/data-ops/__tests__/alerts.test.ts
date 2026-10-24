// Alert ledger and auto-response against the database (#515): a block signature backs the source
// off and alerts once (R6), a repeat breach alerts nothing, and recovery resolves once (R3, R4).
import { schema } from '@causedeck/db';
import { withTestDb, closeTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createAlertRouter,
  createFetchHealth,
  listReviewQueue,
  reconcileDetection,
  runDetectors,
  applyResponses,
  type AlertChannel,
  type AlertMessage,
  type SourceMetrics,
} from '../index.ts';

afterAll(closeTestDb);

const NOW = new Date('2026-10-23T12:00:00Z');

function recorder() {
  const sent: { event: string; message: AlertMessage }[] = [];
  const channel: AlertChannel = {
    name: 'test',
    send(event, message) {
      sent.push({ event, message });
      return Promise.resolve();
    },
  };
  return { sent, notifier: createAlertRouter([channel]) };
}

describe('block signature response', () => {
  it('backs the source off, marks it degraded and alerts exactly once', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      const { sent, notifier } = recorder();
      const health = createFetchHealth({ db, notifier, now: () => NOW });
      const sourceId = 'test.blocked';

      await health.reportBlock({ sourceId, signature: 'http_429', at: NOW });
      await health.reportBlock({ sourceId, signature: 'http_429', at: NOW });

      const until = await health.backoffUntil(sourceId);
      expect(until?.getTime()).toBeGreaterThan(NOW.getTime());
      const [row] = await tx
        .select()
        .from(schema.sourceHealth)
        .where(eq(schema.sourceHealth.sourceId, sourceId));
      expect(row?.state).toBe('degraded');
      const alerts = await tx
        .select()
        .from(schema.dataOpsAlert)
        .where(eq(schema.dataOpsAlert.sourceId, sourceId));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.runbookUrl).toContain('#block-signature');
      expect(sent.filter((s) => s.event === 'opened')).toHaveLength(1);
    });
  });

  it('resolves once when the detector is clean again', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      const { sent, notifier } = recorder();
      const deps = { db, notifier, now: NOW };
      const breach = {
        type: 'freshness',
        sourceId: 'test.stale',
        breached: true,
        detail: 'late',
      } as const;

      await reconcileDetection(deps, breach);
      await reconcileDetection(deps, breach);
      await reconcileDetection(deps, { ...breach, breached: false });
      await reconcileDetection(deps, { ...breach, breached: false });

      expect(sent.map((s) => s.event)).toEqual(['opened', 'resolved']);
      const [row] = await tx
        .select()
        .from(schema.dataOpsAlert)
        .where(eq(schema.dataOpsAlert.sourceId, 'test.stale'));
      expect(row?.status).toBe('resolved');
    });
  });
});

describe('parse-yield response', () => {
  const metrics: SourceMetrics = {
    sourceId: 'test.parser',
    now: NOW,
    slo: { freshnessMinutes: null, successRate: null, parseYieldFloor: 0.8 },
    lastSuccessAt: null,
    calls: { total: 0, failures: 0, blocks: 0 },
    backedOff: false,
    latestParse: { parserVersion: 'v9', expected: 50, parsed: 2 },
    cost: { last24h: 0, baselineDaily: 0 },
    conflicts: { parsed: 0, conflicts: 0 },
  };

  it('quarantines the parser version into the review queue and releases it on recovery', async () => {
    await withTestDb(async (tx) => {
      const db = tx as never;
      await applyResponses(db, metrics, runDetectors(metrics), NOW);
      expect((await listReviewQueue(db)).map((i) => [i.sourceId, i.parserVersion])).toContainEqual([
        'test.parser',
        'v9',
      ]);
      const ok = { ...metrics, latestParse: { parserVersion: 'v10', expected: 50, parsed: 50 } };
      await applyResponses(db, ok, runDetectors(ok), NOW);
      expect((await listReviewQueue(db)).map((i) => i.sourceId)).not.toContain('test.parser');
    });
  });
});
