// Memory server actions (#73): strict zod input and the policy gate run before any core call.
import { describe, expect, it } from 'vitest';

const { editAction, pauseAction, addNoteAction } =
  await import('../app/(app)/w/[slug]/memory/actions.ts');

describe('memory actions (#73)', () => {
  it('rejects input that is not strict before touching anything', async () => {
    for (const result of [
      await editAction({ workspaceId: 'not-a-uuid', itemId: 'x', value: 'v' }),
      await pauseAction({ extra: true }),
      await addNoteAction({ key: 'M1.profile', value: 'v' }),
    ]) {
      expect(result.ok).toBe(false);
    }
  });
});
