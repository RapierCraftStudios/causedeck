// `system.support.session-expire` (#308): every minute, flip support sessions whose grant has
// elapsed to `expired` and audit `support.session_ended` for each. `support_session` is a tenant
// table under FORCE RLS and this job has no workspace, so the update runs in the owner-defined
// `app_expire_support_sessions()` (migration 0025). Access is already refused once `expires_at`
// passes (`assertActiveSupportSession`); the job makes the status and the audit trail match.
import { z } from 'zod';

import { expireSupportSessions } from '../../support/index.ts';
import { defineJob } from '../define.ts';

export const supportSessionExpire = defineJob({
  name: 'system.support.session-expire',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'support-session-expire', policy: 'stately' },
  schedule: { cron: '* * * * *', payload: {} },
  handler: async (ctx) => {
    const expired = await expireSupportSessions(ctx.db);
    ctx.log.info({ expired }, 'expired support sessions');
  },
});
