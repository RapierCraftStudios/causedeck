import { describe, expect, it } from 'vitest';

import { getTask } from '../registry.ts';

const message = { ref: 'm1', ts: '2026-10-12T10:01:00', sender: 'Asha', text: 'File the reply' };

describe('structure_chat task', () => {
  const task = getTask('structure_chat');

  it('is registered with an L2 default and a versioned prompt', () => {
    expect(task.defaultLevel).toBe(2);
    expect(task.promptId).toBe('structure_chat.v1');
  });

  it('accepts an internal chat', () => {
    expect(task.input.safeParse({ chatType: 'internal', messages: [message] }).success).toBe(true);
  });

  it('rejects a client chat, so it can never reach a provider', () => {
    expect(task.input.safeParse({ chatType: 'client', messages: [message] }).success).toBe(false);
    expect(task.input.safeParse({ messages: [message] }).success).toBe(false);
  });

  it('rejects an empty selection', () => {
    expect(task.input.safeParse({ chatType: 'internal', messages: [] }).success).toBe(false);
  });
});
