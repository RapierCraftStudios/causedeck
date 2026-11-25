// `POST /api/copilot/ask` (#1193): the copilot question as an NDJSON stream, so the panel can show the
// stages while the answer is made (a server action returns one result). JSON body as
// `askCopilotAction`: `workspaceId`, `question`, optional `matterId` and `requestId`. Same gates as the
// capture routes (403 cross-origin, 401 signed out, 404 not a member or `copilot.enabled` off, 429 over
// the per-user rate limit), then `matter.read` like the action. A 200 body is one JSON object per line:
// `askCopilot`'s progress events (planning, retrieved, sources, checking, claim, done; only verified
// claims, D-004), then `{type:'result', answer}`, or `{type:'error', error:{code, message}}` with the
// action's client-safe codes and messages (the plan's monthly cap is CONFLICT with its message).
import { isRole } from '@causedeck/auth';
import { assertCan, conceals, isForbiddenError } from '@causedeck/auth/policy';
import type { CopilotProgress } from '@causedeck/core/copilot';
import { consumeRequestLimit, inWorkspace, memberRoleFor } from '@causedeck/core/runtime';
import { z } from 'zod';

import { crossOrigin, json } from '../../../../lib/capture-http.ts';
import { getSession } from '../../../../lib/auth.ts';
import { ActionError } from '../../../../lib/safe-action.ts';
import { toActionError } from '../../../../lib/workspace-action.ts';
import { logger } from '../../../../src/health.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Per user, across workspaces; each question is a model call. */
const COPILOT_RATE_LIMIT = { max: 60, windowSeconds: 10 * 60 } as const;

const AskInput = z.object({
  workspaceId: z.uuid(),
  question: z.string().trim().min(1).max(4000),
  matterId: z.uuid().optional(),
  requestId: z.uuid().optional(),
});

export type CopilotStreamEvent =
  | CopilotProgress
  | { type: 'result'; answer: unknown }
  | { type: 'error'; error: { code: string; message: string } };

const MESSAGES: Record<string, string> = {
  VALIDATION: 'Some fields need attention.',
  FORBIDDEN: 'You do not have access to this.',
  NOT_FOUND: 'We could not find this.',
  CONFLICT: 'This changed while you were working. Reload and try again.',
  INTERNAL: 'Something went wrong. Please try again.',
};

/** The action's client-safe error for `error`; anything unknown is logged and INTERNAL. */
function streamError(error: unknown): { code: string; message: string } {
  if (error instanceof Error && error.name === 'WorkspaceError' && 'code' in error) {
    if (error.code === 'RATE_LIMITED') return { code: 'CONFLICT', message: error.message };
  }
  const mapped = toActionError(error);
  if (mapped instanceof ActionError) {
    return { code: mapped.code, message: mapped.message || (MESSAGES[mapped.code] ?? '') };
  }
  if (isForbiddenError(error)) {
    const code = conceals(error) ? 'NOT_FOUND' : 'FORBIDDEN';
    return { code, message: MESSAGES[code] ?? '' };
  }
  logger.error({ err: error }, 'copilot stream failed');
  return { code: 'INTERNAL', message: MESSAGES.INTERNAL ?? '' };
}

export async function POST(request: Request): Promise<Response> {
  if (crossOrigin(request)) return json(403, { error: 'forbidden' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid_request' });
  }
  const input = AskInput.safeParse(body);
  if (!input.success) return json(400, { error: 'invalid_request' });
  const { workspaceId, question, matterId, requestId } = input.data;

  const session = await getSession();
  if (!session) return json(401, { error: 'unauthorized' });
  const userId = session.user.id;
  const role = await memberRoleFor(userId, workspaceId);
  if (role === null || !isRole(role)) return json(404, { error: 'not_found' });
  try {
    assertCan({ userId, workspaceId, role }, 'matter.read');
  } catch (error) {
    if (isForbiddenError(error)) return json(403, { error: 'forbidden' });
    throw error;
  }
  const { isFlagOffError, requireFlag } = await import('@causedeck/flags/server');
  try {
    await requireFlag('copilot.enabled', { workspaceId, userId });
  } catch (error) {
    if (isFlagOffError(error)) return json(404, { error: 'not_found' });
    throw error;
  }
  if (!(await consumeRequestLimit(`copilot:${userId}`, COPILOT_RATE_LIMIT))) {
    return json(429, { error: 'rate_limited' });
  }

  const { askCopilot } = await import('@causedeck/core/copilot');
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: CopilotStreamEvent): void => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        const answer = await inWorkspace({ workspaceId, userId }, (tx) =>
          askCopilot(
            tx,
            { workspaceId, userId },
            {
              question,
              ...(matterId === undefined ? {} : { matterId }),
              ...(requestId === undefined ? {} : { requestId }),
            },
            { onProgress: send },
          ),
        );
        send({ type: 'result', answer });
      } catch (error) {
        send({ type: 'error', error: streamError(error) });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
