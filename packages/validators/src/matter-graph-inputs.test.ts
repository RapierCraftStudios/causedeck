// Matter-graph service inputs (#362): each accepts a minimal valid value and rejects unknown keys,
// wrong enums and values the services could never store.
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ArchiveMatterInput,
  CreateDocumentInput,
  CreateMatterInput,
  CreateProceedingInput,
  FindDuplicateProceedingsInput,
  LinkProceedingsInput,
  ListMattersInput,
  MergeMattersInput,
  MergeProceedingsInput,
  SplitMatterInput,
  UndoMergeInput,
  UndoMergeProceedingsInput,
  UndoSplitInput,
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

describe('merge and split inputs (#365)', () => {
  it('needs two different matters or proceedings to merge', () => {
    const [a, b] = [id(), id()];
    expect(MergeMattersInput.safeParse({ intoMatterId: a, fromMatterId: b }).success).toBe(true);
    expect(MergeMattersInput.safeParse({ intoMatterId: a, fromMatterId: a }).success).toBe(false);
    expect(
      MergeMattersInput.safeParse({ intoMatterId: a, fromMatterId: b, force: true }).success,
    ).toBe(false);
    expect(
      MergeProceedingsInput.safeParse({ intoProceedingId: a, fromProceedingId: b }).success,
    ).toBe(true);
    expect(
      MergeProceedingsInput.safeParse({ intoProceedingId: a, fromProceedingId: a }).success,
    ).toBe(false);
  });

  it('needs at least one distinct proceeding and a title to split', () => {
    const p = id();
    const split = { matterId: id(), proceedingIds: [p], newTitle: 'Writ appeal' };
    expect(SplitMatterInput.safeParse(split).success).toBe(true);
    expect(SplitMatterInput.safeParse({ ...split, proceedingIds: [] }).success).toBe(false);
    expect(SplitMatterInput.safeParse({ ...split, proceedingIds: [p, p] }).success).toBe(false);
    expect(
      SplitMatterInput.safeParse({ ...split, proceedingIds: [p, p.toUpperCase()] }).success,
    ).toBe(false);
    expect(SplitMatterInput.safeParse({ ...split, newTitle: ' ' }).success).toBe(false);
  });

  it('takes back only a payload of the matching operation and version', () => {
    const at = '2026-10-21 10:00:00.123456+00';
    const stamps = { id: id(), updatedAt: at };
    const merge = {
      op: 'matter.merge',
      version: 1,
      before: {
        intoMatterId: id(),
        fromMatterId: id(),
        fromMatter: { mergedIntoMatterId: null, updatedAt: at },
        rows: {
          proceeding: [stamps],
          document: [],
          roleEdge: [],
          obligation: [],
          task: [],
          mergedMatter: [],
        },
        links: [],
      },
      after: { intoMatterId: id() },
    };
    expect(UndoMergeInput.safeParse({ payload: merge }).success).toBe(true);
    expect(UndoMergeInput.safeParse({ payload: { ...merge, version: 2 } }).success).toBe(false);
    expect(UndoSplitInput.safeParse({ payload: merge }).success).toBe(false);
    const badStamp = {
      ...merge.before,
      rows: { ...merge.before.rows, proceeding: [{ id: id(), updatedAt: 'yesterday' }] },
    };
    expect(UndoMergeInput.safeParse({ payload: { ...merge, before: badStamp } }).success).toBe(
      false,
    );
    const split = {
      op: 'matter.split',
      version: 1,
      before: { matterId: id(), rows: { proceeding: [stamps], obligation: [], task: [] } },
      after: { newMatterId: id() },
    };
    expect(UndoSplitInput.safeParse({ payload: split }).success).toBe(true);
    const proceedingMerge = {
      op: 'proceeding.merge',
      version: 1,
      before: {
        intoProceedingId: id(),
        fromProceedingId: id(),
        into: { id: id(), cnr: null },
        from: { id: id(), matter_id: id() },
        rows: {
          listing: [stamps],
          order: [],
          obligation: [{ ...stamps, matterId: id() }],
          task: [{ ...stamps, matterId: null }],
          roleEdge: [],
          child: [],
          link: [],
        },
        demotedListing: null,
        deletedLinks: [],
      },
      after: {
        intoProceedingId: id(),
        identifierSources: {
          cnr: { proceedingId: id(), sourceType: 'adapter', sourceRef: 'ecourts:1' },
        },
      },
    };
    expect(UndoMergeProceedingsInput.safeParse({ payload: proceedingMerge }).success).toBe(true);
    expect(
      UndoMergeProceedingsInput.safeParse({ payload: { ...proceedingMerge, op: 'matter.merge' } })
        .success,
    ).toBe(false);
  });
});
