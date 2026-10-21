// Matter-graph service inputs (#362): each accepts a minimal valid value and rejects unknown keys,
// wrong enums and values the services could never store.
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ArchiveMatterInput,
  ConfirmNextDateInput,
  CreateDocumentInput,
  CreateMatterInput,
  CreateProceedingInput,
  FindDuplicateProceedingsInput,
  GetCanonicalNextDateInput,
  LinkProceedingsInput,
  ListMattersInput,
  ProposeNextDateInput,
  UpdateIdentifiersInput,
  UpdateMatterInput,
} from './matter-graph-inputs';

const id = () => randomUUID();
const manual = { sourceType: 'manual' } as const;

describe('matter inputs', () => {
  it('accepts a minimal matter and rejects a blank title or an unknown key', () => {
    expect(CreateMatterInput.safeParse({ title: 'Fictional v. State' }).success).toBe(true);
    expect(CreateMatterInput.safeParse({ title: '  ' }).success).toBe(false);
    expect(CreateMatterInput.safeParse({ title: 'X', status: 'archived' }).success).toBe(false);
  });

  it('needs at least one field in an update patch', () => {
    const matterId = id();
    expect(UpdateMatterInput.safeParse({ matterId, patch: { title: 'New' } }).success).toBe(true);
    expect(UpdateMatterInput.safeParse({ matterId, patch: {} }).success).toBe(false);
    expect(ArchiveMatterInput.safeParse({ matterId: 'not-a-uuid' }).success).toBe(false);
  });

  it('defaults the list page size and bounds it', () => {
    expect(ListMattersInput.parse({})).toEqual({ limit: 50 });
    expect(ListMattersInput.safeParse({ limit: 101 }).success).toBe(false);
    expect(ListMattersInput.safeParse({ status: 'merged' }).success).toBe(false);
  });
});

describe('proceeding inputs', () => {
  const base = { matterId: id(), forumId: id(), caseType: 'W.P.', provenance: manual };

  it('accepts two- and four-digit years and rejects three-digit ones', () => {
    expect(CreateProceedingInput.safeParse({ ...base, number: '0045', year: 24 }).success).toBe(
      true,
    );
    expect(CreateProceedingInput.safeParse({ ...base, year: 2026 }).success).toBe(true);
    expect(CreateProceedingInput.safeParse({ ...base, year: 202 }).success).toBe(false);
    expect(CreateProceedingInput.safeParse({ ...base, caseType: '' }).success).toBe(false);
    expect(CreateProceedingInput.safeParse({ ...base, kind: 'other' }).success).toBe(false);
  });

  it('upper-cases a CNR and checks its format', () => {
    const parsed = CreateProceedingInput.parse({ ...base, cnr: ' tnmh010012342026 ' });
    expect(parsed.cnr).toBe('TNMH010012342026');
    expect(CreateProceedingInput.safeParse({ ...base, cnr: 'TNMH-1' }).success).toBe(false);
  });

  it('applies the provenance rule', () => {
    expect(
      CreateProceedingInput.safeParse({ ...base, provenance: { sourceType: 'adapter' } }).success,
    ).toBe(false);
  });

  it('needs an identifier to update and rejects a self link', () => {
    const proceedingId = id();
    expect(UpdateIdentifiersInput.safeParse({ proceedingId }).success).toBe(false);
    expect(UpdateIdentifiersInput.safeParse({ proceedingId, srNo: 'SR 12' }).success).toBe(true);
    const same = id();
    expect(
      LinkProceedingsInput.safeParse({
        fromProceedingId: same,
        toProceedingId: same,
        kind: 'connected',
        provenance: manual,
      }).success,
    ).toBe(false);
    expect(
      LinkProceedingsInput.safeParse({
        fromProceedingId: id(),
        toProceedingId: id(),
        kind: 'judge_of',
        provenance: manual,
      }).success,
    ).toBe(false);
  });

  it('needs a CNR or a full case identity to look for duplicates', () => {
    expect(
      FindDuplicateProceedingsInput.safeParse({ identity: { cnr: 'TNMH010012342026' } }).success,
    ).toBe(true);
    expect(
      FindDuplicateProceedingsInput.safeParse({
        identity: { caseType: 'WP', number: '1', year: 26 },
      }).success,
    ).toBe(true);
    expect(
      FindDuplicateProceedingsInput.safeParse({ identity: { caseType: 'WP', number: '1' } })
        .success,
    ).toBe(false);
  });
});

describe('document input', () => {
  it('requires a lower-case hex SHA-256 and a known kind', () => {
    const doc = {
      matterId: id(),
      kind: 'pleading',
      storageKey: 'ws/x/document/1',
      sha256: 'a'.repeat(64),
    };
    expect(CreateDocumentInput.safeParse(doc).success).toBe(true);
    expect(CreateDocumentInput.safeParse({ ...doc, sha256: 'A'.repeat(64) }).success).toBe(false);
    expect(CreateDocumentInput.safeParse({ ...doc, kind: 'memo' }).success).toBe(false);
  });
});

describe('next-date inputs', () => {
  it('accepts a minimal proposal with defaults and rejects bad dates, ids and keys', () => {
    const proposal = { proceedingId: id(), date: '2026-11-02', provenance: manual };
    expect(ProposeNextDateInput.parse(proposal)).toMatchObject({ listType: 'daily', stageRaw: '' });
    expect(ProposeNextDateInput.safeParse({ ...proposal, date: '02/11/2026' }).success).toBe(false);
    expect(ProposeNextDateInput.safeParse({ ...proposal, proceedingId: 'x' }).success).toBe(false);
    expect(ProposeNextDateInput.safeParse({ ...proposal, canonical: true }).success).toBe(false);
    expect(ProposeNextDateInput.safeParse({ ...proposal, listType: 'weekly' }).success).toBe(false);
  });

  it('refuses a proposal that claims to be confirmed', () => {
    const proposal = { proceedingId: id(), date: '2026-11-02' };
    expect(
      ProposeNextDateInput.safeParse({
        ...proposal,
        provenance: { sourceType: 'manual', confirmationState: 'confirmed' },
      }).success,
    ).toBe(false);
    expect(
      ProposeNextDateInput.safeParse({
        ...proposal,
        provenance: { sourceType: 'manual', confirmationState: 'proposed' },
      }).success,
    ).toBe(true);
    expect(
      ProposeNextDateInput.safeParse({ ...proposal, provenance: { sourceType: 'adapter' } })
        .success,
    ).toBe(false);
  });

  it('defaults allowPast to false and needs a listing or proceeding id', () => {
    const listingId = id();
    expect(ConfirmNextDateInput.parse({ listingId })).toEqual({ listingId, allowPast: false });
    expect(ConfirmNextDateInput.safeParse({ listingId: 'x' }).success).toBe(false);
    expect(ConfirmNextDateInput.safeParse({ listingId, date: '2026-11-02' }).success).toBe(false);
    expect(GetCanonicalNextDateInput.safeParse({ proceedingId: id() }).success).toBe(true);
    expect(GetCanonicalNextDateInput.safeParse({}).success).toBe(false);
  });
});
