import { describe, expect, it } from 'vitest';

import { type BriefState, mergeBrief, resolveConflict } from '../../lib/offline/merge.ts';

const base: BriefState = { note: 'a', prepared: false, carry: { 'doc:1': false } };

describe('mergeBrief', () => {
  it('merges edits to different fields', () => {
    const local = { ...base, note: 'mine' };
    const server = { ...base, prepared: true, carry: { 'doc:1': true } };
    const r = mergeBrief(base, local, server);
    expect(r.conflicts).toEqual([]);
    expect(r.merged).toEqual({ note: 'mine', prepared: true, carry: { 'doc:1': true } });
  });

  it('returns both values for a same-field conflict and keeps the server value meanwhile', () => {
    const r = mergeBrief(base, { ...base, note: 'mine' }, { ...base, note: 'theirs' });
    expect(r.conflicts).toEqual([{ field: 'note', local: 'mine', server: 'theirs' }]);
    expect(r.merged.note).toBe('theirs');
    expect(resolveConflict(r, 'note', 'local').note).toBe('mine');
    expect(resolveConflict(r, 'note', 'server').note).toBe('theirs');
  });

  it('treats identical edits as no conflict', () => {
    const r = mergeBrief(base, { ...base, note: 'x' }, { ...base, note: 'x' });
    expect(r.conflicts).toEqual([]);
    expect(r.merged.note).toBe('x');
  });

  it('merges carry items by key, including ones added on one side', () => {
    const local = { ...base, carry: { 'doc:1': true } };
    const server = { ...base, carry: { 'doc:1': false, 'doc:2': false } };
    const r = mergeBrief(base, local, server);
    expect(r.merged.carry).toEqual({ 'doc:1': true, 'doc:2': false });
  });

  it('conflicts on a carry item ticked differently on both sides', () => {
    const b = { ...base, carry: { 'doc:1': null as unknown as boolean } };
    const r = mergeBrief(
      b,
      { ...b, carry: { 'doc:1': true } },
      { ...b, carry: { 'doc:1': false } },
    );
    expect(r.conflicts.map((c) => c.field)).toEqual(['carry:doc:1']);
  });

  it('last-writer-wins only for listed non-critical fields, with a notice', () => {
    const local = { ...base, note: 'mine' };
    const server = { ...base, note: 'theirs' };
    const r = mergeBrief(base, local, server, { lww: ['note'] });
    expect(r.conflicts).toEqual([]);
    expect(r.notices).toEqual(['note']);
    expect(r.merged.note).toBe('mine');
  });
});
