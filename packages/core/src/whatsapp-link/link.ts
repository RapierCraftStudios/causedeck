// WhatsApp number link service (#678, D-029). A link row exists only after the code was verified
// with the member's opt-in, so "linked" means verified and consented; unlinking deletes the row and
// any pending challenge, which stops all messages. The code is never stored, only a salted hash,
// and the challenge has an expiry, an attempt cap and a resend cooldown.
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { consumeRateLimit } from '@causedeck/auth/rate-limit';
import { CATEGORY_KEYS } from '@causedeck/notifications/categories';
import { and, eq } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { conflict, invalid, notFound, rateLimited } from '../shared/errors.ts';
import { memberRole } from '../workspaces/index.ts';

const { whatsappLink, whatsappOtpChallenge } = schema;

export const WHATSAPP_OTP_MAX_ATTEMPTS = schema.WHATSAPP_OTP_MAX_ATTEMPTS;
export const WHATSAPP_OTP_TTL_MS = 10 * 60_000;
export const WHATSAPP_OTP_RESEND_COOLDOWN_MS = 60_000;
/** Sends per number (any member, any workspace) and per member; keys hold hashes, never numbers. */
export const WHATSAPP_OTP_NUMBER_LIMIT = { max: 5, windowSeconds: 60 * 60 } as const;
export const WHATSAPP_OTP_MEMBER_LIMIT = { max: 10, windowSeconds: 60 * 60 } as const;

const E164 = new RegExp(schema.WHATSAPP_E164_PATTERN);
const CODE = /^\d{6}$/;

type Db = Database | Transaction;

export interface WhatsAppActor {
  userId: string;
  workspaceId: string;
}

export interface WhatsAppDeps {
  db: Db;
  /** Delivers the one-time code to the number (`whatsappOtpSendFromProcess`, #711). */
  sendOtp?: (e164: string, code: string) => Promise<void>;
  now?: () => Date;
  /** Six digits; injectable for tests. */
  generateCode?: () => string;
}

export interface RequestWhatsAppOtpInput {
  /** The number, E.164 (`+919812345678`); spaces and hyphens are ignored. */
  e164: string;
  /** The member's explicit opt-in to WhatsApp messages; required. */
  consent: boolean;
}

export interface WhatsAppLinkView {
  /** Last four digits only; the number is never echoed back in full. */
  maskedNumber: string;
  verifiedAt: Date;
  consentAt: Date;
  categories: string[];
}

export interface WhatsAppSendTarget {
  e164: string;
}

const nowOf = (deps: WhatsAppDeps): Date => (deps.now ?? (() => new Date()))();

function hashCode(challengeSalt: string, code: string): string {
  return createHash('sha256').update(`${challengeSalt}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** `consumeRateLimit` only inserts, which a transaction can do as well as the root client. */
async function withinLimit(
  db: Db,
  key: string,
  limit: { max: number; windowSeconds: number },
  now: Date,
): Promise<void> {
  if (!(await consumeRateLimit(db as Database, key, limit, now.getTime()))) throw rateLimited();
}

const mask = (e164: string): string => `••••${e164.slice(-4)}`;

async function requireMember(db: Db, actor: WhatsAppActor): Promise<void> {
  if ((await memberRole(db, actor.userId, actor.workspaceId)) === null) {
    throw notFound('Workspace not found');
  }
}

function normalise(raw: string): string {
  const e164 = raw.replace(/[\s-]/g, '');
  if (!E164.test(e164))
    throw invalid('Enter the number in international format, e.g. +919812345678');
  return e164;
}

/**
 * Start verification: stores a hash of a fresh code for the number and sends the code to that
 * number. Needs the member's opt-in. One pending challenge per member; a new request replaces it,
 * at most once per `WHATSAPP_OTP_RESEND_COOLDOWN_MS`.
 */
export async function requestWhatsAppOtp(
  deps: WhatsAppDeps,
  actor: WhatsAppActor,
  input: RequestWhatsAppOtpInput,
): Promise<{ expiresAt: Date }> {
  if (!input.consent) throw invalid('Consent to WhatsApp messages is required');
  const e164 = normalise(input.e164);
  await requireMember(deps.db, actor);
  const now = nowOf(deps);
  // Per number first, so one number cannot be flooded from many accounts, then per member. Counted
  // before anything is stored or sent; a refusal that throws leaves the counter at its limit.
  await withinLimit(deps.db, `whatsapp-otp:number:${digest(e164)}`, WHATSAPP_OTP_NUMBER_LIMIT, now);
  await withinLimit(
    deps.db,
    `whatsapp-otp:member:${digest(`${actor.workspaceId}:${actor.userId}`)}`,
    WHATSAPP_OTP_MEMBER_LIMIT,
    now,
  );
  const code = (deps.generateCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, '0')))();
  if (!CODE.test(code)) throw new TypeError('whatsapp-link: the code must be six digits');
  const expiresAt = new Date(now.getTime() + WHATSAPP_OTP_TTL_MS);
  const saved = await withWorkspace(deps.db, actor, async (tx): Promise<string | null> => {
    const [pending] = await tx
      .select({ createdAt: whatsappOtpChallenge.createdAt })
      .from(whatsappOtpChallenge)
      .where(
        and(
          eq(whatsappOtpChallenge.workspaceId, actor.workspaceId),
          eq(whatsappOtpChallenge.userId, actor.userId),
        ),
      );
    if (pending && now.getTime() - pending.createdAt.getTime() < WHATSAPP_OTP_RESEND_COOLDOWN_MS) {
      return null;
    }
    await tx
      .delete(whatsappOtpChallenge)
      .where(
        and(
          eq(whatsappOtpChallenge.workspaceId, actor.workspaceId),
          eq(whatsappOtpChallenge.userId, actor.userId),
        ),
      );
    const challengeId = randomUUID();
    await tx.insert(whatsappOtpChallenge).values({
      id: challengeId,
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      e164,
      codeHash: hashCode(challengeId, code),
      consentAt: now,
      expiresAt,
      createdAt: now,
    });
    // Ids only: never the number or the code.
    await record(
      { db: tx, workspaceId: actor.workspaceId, actor: { userId: actor.userId, kind: 'user' } },
      {
        action: 'whatsapp.otp_requested',
        target: { kind: 'whatsapp_otp_challenge', id: challengeId },
      },
    );
    return challengeId;
  });
  if (saved === null) throw rateLimited();
  if (deps.sendOtp !== undefined) {
    try {
      await deps.sendOtp(e164, code);
    } catch {
      await withWorkspace(deps.db, actor, (tx) =>
        tx
          .delete(whatsappOtpChallenge)
          .where(
            and(
              eq(whatsappOtpChallenge.workspaceId, actor.workspaceId),
              eq(whatsappOtpChallenge.userId, actor.userId),
            ),
          ),
      );
      // Provider detail stays out of the member's message (and out of logs here).
      throw conflict('We could not send the code. Try again later.');
    }
  }
  return { expiresAt };
}

type LinkRow = typeof whatsappLink.$inferSelect;
type VerifyOutcome =
  { result: 'ok'; link: LinkRow } | { result: 'none' | 'expired' | 'locked' | 'wrong' };

/**
 * Check the code. A right code creates (or replaces) the member's link with the opt-in recorded
 * at request time and consumes the challenge. A wrong code counts an attempt; after
 * `WHATSAPP_OTP_MAX_ATTEMPTS` the challenge is dead and a new code must be requested.
 */
export async function verifyWhatsAppOtp(
  deps: WhatsAppDeps,
  actor: WhatsAppActor,
  input: { code: string },
): Promise<WhatsAppLinkView> {
  await requireMember(deps.db, actor);
  const now = nowOf(deps);
  const submitted = input.code.trim();
  const outcome = await withWorkspace(deps.db, actor, async (tx): Promise<VerifyOutcome> => {
    const [challenge] = await tx
      .select()
      .from(whatsappOtpChallenge)
      .where(
        and(
          eq(whatsappOtpChallenge.workspaceId, actor.workspaceId),
          eq(whatsappOtpChallenge.userId, actor.userId),
        ),
      )
      .for('update');
    if (challenge === undefined) return { result: 'none' };
    if (challenge.expiresAt.getTime() <= now.getTime()) {
      await tx.delete(whatsappOtpChallenge).where(eq(whatsappOtpChallenge.id, challenge.id));
      return { result: 'expired' };
    }
    if (challenge.attempts >= WHATSAPP_OTP_MAX_ATTEMPTS) return { result: 'locked' };
    if (!CODE.test(submitted) || !sameHash(hashCode(challenge.id, submitted), challenge.codeHash)) {
      await tx
        .update(whatsappOtpChallenge)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(whatsappOtpChallenge.id, challenge.id));
      await record(
        { db: tx, workspaceId: actor.workspaceId, actor: { userId: actor.userId, kind: 'user' } },
        {
          action: 'whatsapp.otp_failed',
          target: { kind: 'whatsapp_otp_challenge', id: challenge.id },
          outcome: 'denied',
          metadata: { attempts: challenge.attempts + 1 },
        },
      );
      return { result: 'wrong' };
    }
    await tx.delete(whatsappOtpChallenge).where(eq(whatsappOtpChallenge.id, challenge.id));
    const [link] = await tx
      .insert(whatsappLink)
      .values({
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        e164: challenge.e164,
        verifiedAt: now,
        consentAt: challenge.consentAt,
      })
      .onConflictDoUpdate({
        target: [whatsappLink.workspaceId, whatsappLink.userId],
        set: {
          e164: challenge.e164,
          verifiedAt: now,
          consentAt: challenge.consentAt,
          categories: [],
          updatedAt: now,
        },
      })
      .returning();
    if (link === undefined) throw new Error('whatsapp-link: link upsert returned no row');
    await record(
      { db: tx, workspaceId: actor.workspaceId, actor: { userId: actor.userId, kind: 'user' } },
      { action: 'whatsapp.linked', target: { kind: 'whatsapp_link', id: link.id } },
    );
    return { result: 'ok', link };
  });
  if (outcome.result === 'ok') return view(outcome.link);
  if (outcome.result === 'none') throw notFound('No verification is pending');
  if (outcome.result === 'expired') throw invalid('The code has expired; request a new one');
  if (outcome.result === 'locked') throw invalid('Too many wrong codes; request a new one');
  throw invalid('That code is not right');
}

function view(row: typeof whatsappLink.$inferSelect): WhatsAppLinkView {
  return {
    maskedNumber: mask(row.e164),
    verifiedAt: row.verifiedAt,
    consentAt: row.consentAt,
    categories: row.categories,
  };
}

const ownLink = (actor: WhatsAppActor) =>
  and(eq(whatsappLink.workspaceId, actor.workspaceId), eq(whatsappLink.userId, actor.userId));

/** The member's own link, or null when none (never linked, or unlinked). */
export async function getWhatsAppLink(
  deps: WhatsAppDeps,
  actor: WhatsAppActor,
): Promise<WhatsAppLinkView | null> {
  await requireMember(deps.db, actor);
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx.select().from(whatsappLink).where(ownLink(actor)),
  );
  return row === undefined ? null : view(row);
}

/** Choose the notification categories sent to WhatsApp; unknown keys are refused. */
export async function setWhatsAppCategories(
  deps: WhatsAppDeps,
  actor: WhatsAppActor,
  input: { categories: readonly string[] },
): Promise<WhatsAppLinkView> {
  const known: readonly string[] = CATEGORY_KEYS;
  const unknown = input.categories.filter((key) => !known.includes(key));
  if (unknown.length > 0) throw invalid(`Unknown categories: ${unknown.join(', ')}`);
  await requireMember(deps.db, actor);
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .update(whatsappLink)
      .set({ categories: [...new Set(input.categories)], updatedAt: nowOf(deps) })
      .where(ownLink(actor))
      .returning(),
  );
  if (row === undefined) throw conflict('Link a WhatsApp number first');
  return view(row);
}

/** Unlink: deletes the link and any pending challenge, so nothing is sent afterwards. Idempotent. */
export async function unlinkWhatsApp(deps: WhatsAppDeps, actor: WhatsAppActor): Promise<void> {
  await requireMember(deps.db, actor);
  await withWorkspace(deps.db, actor, async (tx) => {
    await tx.delete(whatsappLink).where(ownLink(actor));
    await tx
      .delete(whatsappOtpChallenge)
      .where(
        and(
          eq(whatsappOtpChallenge.workspaceId, actor.workspaceId),
          eq(whatsappOtpChallenge.userId, actor.userId),
        ),
      );
  });
}

/**
 * The only way to get a destination for a message (D-029): the verified, consented number of
 * `actor.userId` in `actor.workspaceId`, and only when the user is still a member and, if given, the
 * category is one they chose. Never a number for any other user; null means do not send.
 */
export async function getWhatsAppSendTarget(
  deps: WhatsAppDeps,
  actor: WhatsAppActor,
  input: { category?: string } = {},
): Promise<WhatsAppSendTarget | null> {
  if ((await memberRole(deps.db, actor.userId, actor.workspaceId)) === null) return null;
  const [row] = await withWorkspace(deps.db, actor, (tx) =>
    tx.select().from(whatsappLink).where(ownLink(actor)),
  );
  if (row === undefined) return null;
  if (input.category !== undefined && !row.categories.includes(input.category)) return null;
  return { e164: row.e164 };
}
