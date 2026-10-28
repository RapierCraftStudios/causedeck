// The signed-out read of a client status link (#88, ADR 0049). The flag is checked first: with it
// off every token, even a previously created one, is NOT_FOUND. Dead links (unknown, expired, revoked,
// purged) are one generic `unavailable` result. The only cross-workspace read is the owner-defined
// `app_status_link_view` by token hash. Each valid view writes one access row (time and a coarse
// user-agent class); no IP is stored, and the per-IP rate-limit key uses a keyed hash of it.
import { createHmac } from 'node:crypto';

import { consumeRateLimit } from '@causedeck/auth/rate-limit';
import { type Database, type Queryable, type Transaction } from '@causedeck/db';
import { isEnabled } from '@causedeck/flags';
import type { StatusLinkLanguage, StatusLinkView } from '@causedeck/validators/status-link';
import { sql } from 'drizzle-orm';

import { hashStatusLinkToken, STATUS_LINKS_FLAG } from './create.ts';

export const STATUS_LINK_RATE_LIMIT = { max: 30, windowSeconds: 60 } as const;

export type StatusLinkUaClass = 'mobile' | 'desktop' | 'bot' | 'other';

export type ResolvedStatusLink =
  | { state: 'not_found' | 'unavailable' | 'rate_limited' }
  | { state: 'ok'; view: StatusLinkView };

export interface ResolveDeps {
  db: Database | Transaction;
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
  now?: () => Date;
  /** Secret for the keyed IP hash used in the rate-limit key only. */
  ipSecret?: string;
}

interface ViewRow {
  id: string;
  workspace_id: string;
  advocate_name: string | null;
  payload: { headline?: string; note?: string; nextDate?: string | null };
  language: StatusLinkLanguage;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  purged_at: Date | string | null;
}

/** A coarse class of the user agent: never the string itself. */
export function classifyUserAgent(ua: string | null | undefined): StatusLinkUaClass {
  if (!ua) return 'other';
  if (/bot|crawler|spider|preview|curl|wget/i.test(ua)) return 'bot';
  if (/mobile|android|iphone|ipad/i.test(ua)) return 'mobile';
  if (/windows|macintosh|linux|x11|cros/i.test(ua)) return 'desktop';
  return 'other';
}

function ipKey(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

export async function resolveStatusLink(
  deps: ResolveDeps,
  input: { token: string; ip?: string | null; userAgent?: string | null },
): Promise<ResolvedStatusLink> {
  const now = deps.now?.() ?? new Date();
  // The flag is workspace-scoped, but the viewer has no workspace: the global flag state decides
  // here, and the row's own workspace is checked again below.
  const flag =
    deps.flagEnabled ??
    ((workspaceId: string) =>
      isEnabled(STATUS_LINKS_FLAG, { workspaceId }, { db: deps.db as Database }));
  const { token } = input;
  if (token.length < 16 || token.length > 128) return { state: 'not_found' };
  const hash = hashStatusLinkToken(token);
  const secret = deps.ipSecret ?? process.env['STATUS_LINKS_IP_SECRET'] ?? 'status-link';
  const limited = !(await consumeRateLimit(
    deps.db as Database,
    `status-link:${ipKey(input.ip ?? 'unknown', secret)}:${hash.slice(0, 16)}`,
    STATUS_LINK_RATE_LIMIT,
    now.getTime(),
  ));
  if (limited) return { state: 'rate_limited' };
  const db = deps.db as Queryable;
  const rows = await db.execute<ViewRow>(sql`select * from app_status_link_view(${hash})`);
  const row = rows[0];
  if (row === undefined) return { state: 'not_found' };
  if (!(await flag(row.workspace_id))) return { state: 'not_found' };
  if (
    row.revoked_at !== null ||
    row.purged_at !== null ||
    new Date(row.expires_at).getTime() <= now.getTime()
  ) {
    return { state: 'unavailable' };
  }
  await db.execute(
    sql`select app_status_link_record_view(${row.id}::uuid, ${classifyUserAgent(input.userAgent)})`,
  );
  return {
    state: 'ok',
    view: {
      headline: row.payload.headline ?? '',
      note: row.payload.note ?? '',
      nextDate: row.payload.nextDate ?? null,
      language: row.language,
      advocateName: row.advocate_name,
      expiresAt: new Date(row.expires_at).toISOString(),
    },
  };
}
