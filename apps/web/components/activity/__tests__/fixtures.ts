// Fixtures shared by the activity feed stories (#49): activities as `listActivities` returns them,
// and server actions that answer without a server.
import type { ActivityView } from '@causedeck/core/automation';

import type { FeedActions } from '../activity-feed.tsx';

export const WORKSPACE = { id: '00000000-0000-4000-8000-00000000a001', slug: 'demo' };
export const OWNER = '00000000-0000-4000-8000-0000000000a1';
export const MATTER = '00000000-0000-4000-8000-0000000000b1';
export const NOW = new Date('2026-10-21T06:00:00.000Z');
export const MEMBERS = [{ userId: OWNER, name: 'Asha Rao' }];

let counter = 0;

export function activity(overrides: Partial<ActivityView> = {}): ActivityView {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    kind: 'document_attach',
    level: 'L3',
    actor: 'system',
    actorUserId: null,
    summary: 'Attached order to W.P. 12345 of 2026 · matched by case number',
    redacted: false,
    matterId: MATTER,
    matterTitle: 'Ilango v. State (fictional)',
    captureId: null,
    inputSource: 'document',
    model: 'sarvam-m',
    modelVersion: '2026-09',
    region: 'ap-south-1',
    confidence: '0.930',
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-10-21T03:00:00.000Z',
    undoExpiresAt: '2026-10-28T03:00:00.000Z',
    undoneAt: null,
    undoneBy: null,
    cascadeGroupId: null,
    undoable: true,
    ...overrides,
  };
}

/** A day of activity: an auto-applied attach, a confirmed proposal, a capture, and an older one. */
export function sampleFeed(): ActivityView[] {
  return [
    activity(),
    activity({
      summary: 'Created a task: collect the certified copy',
      kind: 'task',
      inputSource: 'voice',
      createdAt: '2026-10-21T02:00:00.000Z',
    }),
    activity({
      summary: 'You confirmed the next date, 14 Nov 2026',
      kind: 'next_date',
      level: 'L2',
      actor: 'user',
      actorUserId: OWNER,
      confirmedBy: OWNER,
      confirmedAt: '2026-10-20T10:00:00.000Z',
      createdAt: '2026-10-20T09:00:00.000Z',
      undoable: false,
    }),
    activity({
      summary: 'Added the matter from the cause list',
      kind: 'new_matter',
      level: 'L1',
      inputSource: 'list',
      model: null,
      modelVersion: null,
      region: null,
      createdAt: '2026-10-10T05:00:00.000Z',
      undoExpiresAt: '2026-10-17T05:00:00.000Z',
      undoable: false,
    }),
  ];
}

export const actions: FeedActions = {
  loadMore: () =>
    Promise.resolve({ ok: true, data: { items: [], nextCursor: null, canUndo: true } }),
  preview: ({ activityId }) =>
    Promise.resolve({
      ok: true,
      data: {
        activityId,
        undoable: true,
        blockedReason: null,
        willRemove: [
          { activityId, kind: 'document_attach', summary: 'Attached the order to the matter' },
          { activityId: 'child-1', kind: 'task', summary: '2 tasks created from it' },
          { activityId: 'child-2', kind: 'listing_update', summary: 'Listing details for 14 Nov' },
        ],
        matterId: MATTER,
      },
    }),
  undo: ({ activityId }) =>
    Promise.resolve({
      ok: true,
      data: {
        status: 'undone',
        undone: [{ activityId, kind: 'document_attach', summary: 'Attached the order' }],
        skipped: [],
      },
    }),
  undoCapture: () =>
    Promise.resolve({ ok: true, data: { status: 'undone', undone: [], skipped: [] } }),
  reassign: () => Promise.resolve({ ok: true, data: {} }),
  searchMatters: () => Promise.resolve({ ok: true, data: [] }),
};
