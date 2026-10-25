import { createMockProvider, getTask, type AiGateway } from '@causedeck/ai';
import { NOTICE_KINDS } from '@causedeck/db/schema';
import { describe, expect, it } from 'vitest';

import { tagNotice, type TagNoticeInput } from '../index.ts';

const ALLOWED = ['in.tn.madras-hc.madurai', 'in.tn.madras-hc.principal.original'];
const scope = { workspaceId: 'system' } as const;
const notice: TagNoticeInput = {
  title: 'Meeting regarding stationery',
  sourceId: 'in.tn.madras-hc.notices',
  url: 'https://www.mhc.example/n/1.pdf',
  kindHint: null,
  forumCodes: ALLOWED,
};

/** A gateway answering from `output` and counting calls. */
function gatewayOf(output: unknown): { gateway: AiGateway; calls: string[] } {
  const calls: string[] = [];
  const gateway = {
    run(task: string) {
      calls.push(task);
      return Promise.resolve({ output });
    },
  } as unknown as AiGateway;
  return { gateway, calls };
}

describe('tag_notice task', () => {
  it('accepts exactly the schema notice kinds', () => {
    const task = getTask('tag_notice');
    for (const kind of NOTICE_KINDS) {
      expect(task.output.safeParse({ kind, forumCodes: [], confidence: 1 }).success).toBe(true);
    }
    expect(task.output.safeParse({ kind: 'press', forumCodes: [], confidence: 1 }).success).toBe(
      false,
    );
  });

  it('has a schema-valid mock-provider path', async () => {
    const task = getTask('tag_notice');
    const mock = createMockProvider({ fixturesDir: '/nonexistent' });
    const result = await mock.call(task, { title: 'x', sourceId: 's' }, { suspicious: false });
    expect(task.output.safeParse(result.output).success).toBe(true);
  });
});

describe('tagNotice', () => {
  it('uses the title rules without calling the gateway', async () => {
    const { gateway, calls } = gatewayOf({});
    const tag = await tagNotice(
      { gateway, scope, allowedForumCodes: ALLOWED },
      { ...notice, kindHint: 'holiday' },
    );
    expect(tag).toEqual({ kind: 'holiday', forumCodes: ALLOWED, via: 'rules' });
    expect(calls).toEqual([]);
  });

  it('asks the model when the rules leave the kind open, keeping only allowed forum codes', async () => {
    const { gateway, calls } = gatewayOf({
      kind: 'registry',
      forumCodes: ['in.tn.madras-hc.madurai', 'in.xx.unknown'],
      confidence: 0.9,
    });
    const tag = await tagNotice({ gateway, scope, allowedForumCodes: ALLOWED }, notice);
    expect(tag).toEqual({
      kind: 'registry',
      forumCodes: ['in.tn.madras-hc.madurai'],
      via: 'model',
    });
    expect(calls).toEqual(['tag_notice']);
  });

  it('falls back to other and the parser forum codes on an invalid model output', async () => {
    const { gateway } = gatewayOf({ kind: 'press_release', forumCodes: 'all' });
    const tag = await tagNotice({ gateway, scope, allowedForumCodes: ALLOWED }, notice);
    expect(tag).toEqual({ kind: 'other', forumCodes: ALLOWED, via: 'fallback' });
  });

  it('falls back when the gateway fails', async () => {
    const gateway = {
      run: () => Promise.reject(new Error('budget exhausted')),
    } as unknown as AiGateway;
    const tag = await tagNotice({ gateway, scope, allowedForumCodes: ALLOWED }, notice);
    expect(tag.via).toBe('fallback');
    expect(tag.kind).toBe('other');
  });
});
