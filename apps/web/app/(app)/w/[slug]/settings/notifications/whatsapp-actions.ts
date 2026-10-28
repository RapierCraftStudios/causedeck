'use server';
// WhatsApp link server actions (#681, part 4 of #502, D-029): request a one-time code for a number
// (with the member's opt-in), verify it, choose the categories sent to WhatsApp, unlink, and read the
// link. Each goes through `workspaceAction` (zod input, session, membership) and calls
// `@causedeck/core/whatsapp-link` on the workspace-scoped transaction `ctx.tx`. The input never names
// a user: the actor is always the signed-in member, so a member only touches their own link. The
// client only ever sees the masked number. The request action passes the env-selected `sendOtp`
// (#711): the real provider only with its env and approved template, else the console sender.
import { z } from 'zod';

import { domainErrorCode } from '../../../../../../lib/matters/graph-deps.ts';
import { ActionError, type Result } from '../../../../../../lib/safe-action.ts';
import {
  WorkspaceScoped,
  workspaceAction,
  type WorkspaceActionCtx,
} from '../../../../../../lib/workspace-action.ts';

/** The member's link as the client sees it: the number is masked, dates are ISO strings. */
export interface WhatsAppLinkState {
  maskedNumber: string;
  verifiedAt: string;
  consentAt: string;
  categories: string[];
}

const RequestInput = WorkspaceScoped.extend({
  e164: z.string().min(1).max(32),
  consent: z.boolean(),
});
const VerifyInput = WorkspaceScoped.extend({ code: z.string().regex(/^\d{6}$/) });
const CategoriesInput = WorkspaceScoped.extend({ categories: z.array(z.string().max(64)).max(64) });

const core = () => import('@causedeck/core/whatsapp-link');

const deps = (ctx: WorkspaceActionCtx) => ({ db: ctx.tx });
const actorOf = (ctx: WorkspaceActionCtx) => ({
  userId: ctx.userId,
  workspaceId: ctx.workspaceId,
});

/** Core domain errors as the matching `ActionError` (rate limiting reads as a conflict). */
async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const code = domainErrorCode(error);
    if (code === 'RATE_LIMITED') throw new ActionError('CONFLICT', (error as Error).message);
    if (
      code === 'NOT_FOUND' ||
      code === 'FORBIDDEN' ||
      code === 'CONFLICT' ||
      code === 'VALIDATION'
    ) {
      throw new ActionError(code, (error as Error).message);
    }
    throw error;
  }
}

const toState = (view: {
  maskedNumber: string;
  verifiedAt: Date;
  consentAt: Date;
  categories: string[];
}): WhatsAppLinkState => ({
  maskedNumber: view.maskedNumber,
  verifiedAt: view.verifiedAt.toISOString(),
  consentAt: view.consentAt.toISOString(),
  categories: view.categories,
});

const requestOtp = workspaceAction(RequestInput, async (input, ctx) => {
  const { requestWhatsAppOtp, whatsappOtpSendFromProcess } = await core();
  const { expiresAt } = await guarded(() =>
    requestWhatsAppOtp({ ...deps(ctx), sendOtp: whatsappOtpSendFromProcess() }, actorOf(ctx), {
      e164: input.e164,
      consent: input.consent,
    }),
  );
  return { expiresAt: expiresAt.toISOString() };
});

// A wrong code counts an attempt in core and then throws. A thrown error rolls the action's
// transaction back, which would undo the count and allow unlimited guesses, so a refused code is
// returned as a value (the transaction commits) and turned into the error result afterwards.
type Verified =
  { ok: true; link: WhatsAppLinkState } | { ok: false; code: ActionError['code']; message: string };

const verifyOtp = workspaceAction(VerifyInput, async (input, ctx): Promise<Verified> => {
  const { verifyWhatsAppOtp } = await core();
  try {
    const view = await guarded(() =>
      verifyWhatsAppOtp(deps(ctx), actorOf(ctx), { code: input.code }),
    );
    return { ok: true, link: toState(view) };
  } catch (error) {
    if (error instanceof ActionError && error.code === 'VALIDATION') {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
});

const setCategories = workspaceAction(CategoriesInput, async (input, ctx) => {
  const { setWhatsAppCategories } = await core();
  return toState(
    await guarded(() =>
      setWhatsAppCategories(deps(ctx), actorOf(ctx), { categories: input.categories }),
    ),
  );
});

const unlink = workspaceAction(WorkspaceScoped, async (_input, ctx) => {
  const { unlinkWhatsApp } = await core();
  await guarded(() => unlinkWhatsApp(deps(ctx), actorOf(ctx)));
  return { unlinked: true as const };
});

const getLink = workspaceAction(WorkspaceScoped, async (_input, ctx) => {
  const { getWhatsAppLink } = await core();
  const view = await guarded(() => getWhatsAppLink(deps(ctx), actorOf(ctx)));
  return view === null ? null : toState(view);
});

// A `'use server'` module may only export async functions, so each action is wrapped.

export async function requestWhatsAppOtpAction(
  raw: unknown,
): Promise<Result<{ expiresAt: string }>> {
  return requestOtp(raw);
}

export async function verifyWhatsAppOtpAction(raw: unknown): Promise<Result<WhatsAppLinkState>> {
  const result = await verifyOtp(raw);
  if (!result.ok) return result;
  if (!result.data.ok) {
    return { ok: false, error: { code: result.data.code, message: result.data.message } };
  }
  return { ok: true, data: result.data.link };
}

export async function setWhatsAppCategoriesAction(
  raw: unknown,
): Promise<Result<WhatsAppLinkState>> {
  return setCategories(raw);
}

export async function unlinkWhatsAppAction(raw: unknown): Promise<Result<{ unlinked: true }>> {
  return unlink(raw);
}

export async function getWhatsAppLinkAction(
  raw: unknown,
): Promise<Result<WhatsAppLinkState | null>> {
  return getLink(raw);
}
