import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ListingInsertSchema,
  ObligationInsertSchema,
  ProceedingInsertSchema,
  ProceedingStateChangeInsertSchema,
  ProceedingStateChangeSelectSchema,
  ProvenanceSchema,
  RoleEdgeInsertSchema,
} from './matter-graph';

const workspaceId = randomUUID();

/** The issue paths of a failed parse. */
function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('ProvenanceSchema', () => {
  it('accepts a manual fact without a source', () => {
    expect(ProvenanceSchema.safeParse({ sourceType: 'manual' }).success).toBe(true);
  });

  it('requires an anchorId or a sourceRef on a non-manual fact', () => {
    expect(issuePaths(ProvenanceSchema.safeParse({ sourceType: 'adapter' }))).toEqual(['anchorId']);
    expect(ProvenanceSchema.safeParse({ sourceType: 'adapter', sourceRef: 'list:1' }).success).toBe(
      true,
    );
    expect(ProvenanceSchema.safeParse({ sourceType: 'ai', anchorId: randomUUID() }).success).toBe(
      true,
    );
  });

  it('keeps confidence within 0..1', () => {
    const base = { sourceType: 'manual' } as const;
    expect(ProvenanceSchema.safeParse({ ...base, confidence: '0.875' }).success).toBe(true);
    expect(ProvenanceSchema.safeParse({ ...base, confidence: '1' }).success).toBe(true);
    expect(ProvenanceSchema.safeParse({ ...base, confidence: '1.5' }).success).toBe(false);
    expect(ProvenanceSchema.safeParse({ ...base, confidence: '-0.1' }).success).toBe(false);
  });
});

describe('ListingInsertSchema', () => {
  const listing = {
    workspaceId,
    proceedingId: randomUUID(),
    listDate: '2026-11-02',
    listType: 'daily',
    stageRaw: 'FOR ADMISSION',
    sourceType: 'manual',
  } as const;

  it('accepts a minimal listing and rejects a non-date list date', () => {
    expect(ListingInsertSchema.safeParse(listing).success).toBe(true);
    expect(ListingInsertSchema.safeParse({ ...listing, listDate: '02/11/2026' }).success).toBe(
      false,
    );
  });

  it('applies the provenance rule', () => {
    expect(
      issuePaths(ListingInsertSchema.safeParse({ ...listing, sourceType: 'adapter' })),
    ).toEqual(['anchorId']);
  });
});

describe('ObligationInsertSchema', () => {
  const open = {
    workspaceId,
    matterId: randomUUID(),
    source: 'order_direction',
    description: 'File counter affidavit',
    sourceType: 'manual',
  } as const;

  it('accepts an open obligation', () => {
    expect(ObligationInsertSchema.safeParse(open).success).toBe(true);
  });

  it('rejects a closed obligation without its closure fields', () => {
    expect(issuePaths(ObligationInsertSchema.safeParse({ ...open, status: 'done' }))).toEqual([
      'closedReasonType',
      'closedBy',
      'closedAt',
    ]);
    const closed = {
      ...open,
      status: 'done',
      closedReasonType: 'lawyer_action',
      closedBy: randomUUID(),
      closedAt: new Date(),
    } as const;
    expect(ObligationInsertSchema.safeParse(closed).success).toBe(true);
  });

  it('requires a non-blank note when not applicable', () => {
    const notApplicable = {
      ...open,
      status: 'not_applicable',
      closedReasonType: 'not_applicable',
      closedBy: randomUUID(),
      closedAt: new Date(),
    } as const;
    expect(
      issuePaths(ObligationInsertSchema.safeParse({ ...notApplicable, closedNote: '  ' })),
    ).toEqual(['closedNote']);
    expect(
      ObligationInsertSchema.safeParse({ ...notApplicable, closedNote: 'Order recalled' }).success,
    ).toBe(true);
  });
});

describe('RoleEdgeInsertSchema', () => {
  const edge = {
    workspaceId,
    kind: 'represents',
    fromPersonId: randomUUID(),
    sourceType: 'manual',
  } as const;

  it('needs exactly one target', () => {
    expect(RoleEdgeInsertSchema.safeParse(edge).success).toBe(false);
    expect(RoleEdgeInsertSchema.safeParse({ ...edge, matterId: randomUUID() }).success).toBe(true);
    expect(
      RoleEdgeInsertSchema.safeParse({
        ...edge,
        matterId: randomUUID(),
        proceedingId: randomUUID(),
      }).success,
    ).toBe(false);
  });

  it('rejects an edge to the same person', () => {
    expect(RoleEdgeInsertSchema.safeParse({ ...edge, toPersonId: edge.fromPersonId }).success).toBe(
      false,
    );
  });
});

describe('ProceedingInsertSchema', () => {
  const proceeding = {
    workspaceId,
    matterId: randomUUID(),
    forumId: randomUUID(),
    caseTypeCode: 'WP',
    sourceType: 'manual',
  } as const;

  it('requires a normalised case type code', () => {
    expect(ProceedingInsertSchema.safeParse(proceeding).success).toBe(true);
    for (const caseTypeCode of ['W.P.', 'wp', 'W P', '']) {
      expect(ProceedingInsertSchema.safeParse({ ...proceeding, caseTypeCode }).success).toBe(false);
    }
  });

  it('requires a number and a year once numbered', () => {
    expect(ProceedingInsertSchema.safeParse({ ...proceeding, state: 'numbered' }).success).toBe(
      false,
    );
    expect(
      ProceedingInsertSchema.safeParse({
        ...proceeding,
        state: 'numbered',
        number: '12345',
        year: 2026,
      }).success,
    ).toBe(true);
    expect(ProceedingInsertSchema.safeParse({ ...proceeding, state: 'sr_fr' }).success).toBe(true);
  });

  it('checks the CNR format', () => {
    expect(
      ProceedingInsertSchema.safeParse({ ...proceeding, cnr: 'TNHC010012342026' }).success,
    ).toBe(true);
    expect(ProceedingInsertSchema.safeParse({ ...proceeding, cnr: 'tnhc01' }).success).toBe(false);
  });
});

describe('ProceedingStateChangeInsertSchema (#363)', () => {
  const change = {
    workspaceId,
    proceedingId: randomUUID(),
    fromState: 'sr_fr',
    toState: 'defects',
    sourceType: 'manual',
  } as const;

  it('accepts a transition and mirrors the table CHECKs', () => {
    expect(ProceedingStateChangeInsertSchema.safeParse(change).success).toBe(true);
    expect(
      ProceedingStateChangeInsertSchema.safeParse({ ...change, cureDeadline: '2026-11-02' })
        .success,
    ).toBe(true);
    expect(
      issuePaths(ProceedingStateChangeInsertSchema.safeParse({ ...change, toState: 'sr_fr' })),
    ).toEqual(['toState']);
    expect(
      issuePaths(
        ProceedingStateChangeInsertSchema.safeParse({
          ...change,
          fromState: 're_presented',
          toState: 'numbered',
          cureDeadline: '2026-11-02',
        }),
      ),
    ).toEqual(['cureDeadline']);
    expect(
      issuePaths(
        ProceedingStateChangeInsertSchema.safeParse({
          ...change,
          fromState: 'disposed',
          toState: 'numbered',
        }),
      ),
    ).toEqual(['reason']);
    expect(ProceedingStateChangeInsertSchema.safeParse({ ...change, reason: '  ' }).success).toBe(
      false,
    );
  });

  it('selects every column, nullable where the table is', () => {
    const now = new Date();
    const row = {
      ...change,
      id: randomUUID(),
      reason: null,
      actorMemberId: null,
      cureDeadline: null,
      changedAt: now,
      sourceRef: null,
      anchorId: null,
      confidence: null,
      confirmationState: 'confirmed',
      capturedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    expect(ProceedingStateChangeSelectSchema.safeParse(row).success).toBe(true);
    expect(
      ProceedingStateChangeSelectSchema.safeParse({ ...row, changedAt: undefined }).success,
    ).toBe(false);
  });
});
