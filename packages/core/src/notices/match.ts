// Notice matching (#586, D-048): a notice names catalogue forum codes; it is matched to every
// workspace that has a proceeding before one of those forums (reason `forum`, one row per workspace
// and forum) and to each such matter (reason `matter_forum`). The poll has no workspace, so the
// workspaces are found only through the owner-defined `app_notice_match_targets` (ids and the forum
// code, 0074) and every `notice_match` row is written inside that workspace's own scope.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { sql } from 'drizzle-orm';

const { noticeMatch } = schema;

/** A stored notice to match: its id and the forum catalogue codes it concerns. */
export interface NoticeToMatch {
  id: string;
  forumCodes: readonly string[];
}

export interface MatchNoticesReport {
  /** Workspaces that received at least one match row. */
  workspaces: number;
  /** `notice_match` rows inserted (a row that already existed is not counted). */
  matches: number;
}

interface Target {
  workspace_id: string;
  matter_id: string;
  forum_id: string;
}

/** Match `notices` to the workspaces and matters that use their forums. Idempotent. */
export async function matchNotices(
  deps: { db: Database | Transaction },
  notices: readonly NoticeToMatch[],
): Promise<MatchNoticesReport> {
  const byWorkspace = new Map<string, (typeof noticeMatch.$inferInsert)[]>();
  for (const notice of notices) {
    if (notice.forumCodes.length === 0) continue;
    const codes = sql.join(
      notice.forumCodes.map((code) => sql`${code}`),
      sql`, `,
    );
    const targets = await deps.db.execute<Target>(
      sql`select workspace_id::text, matter_id::text, forum_id::text from app_notice_match_targets(array[${codes}]::text[])`,
    );
    const forums = new Set<string>();
    for (const target of targets) {
      const rows = byWorkspace.get(target.workspace_id) ?? [];
      byWorkspace.set(target.workspace_id, rows);
      const forumKey = `${target.workspace_id}:${target.forum_id}`;
      if (!forums.has(forumKey)) {
        forums.add(forumKey);
        rows.push({
          workspaceId: target.workspace_id,
          noticeId: notice.id,
          forumId: target.forum_id,
          reason: 'forum',
        });
      }
      rows.push({
        workspaceId: target.workspace_id,
        noticeId: notice.id,
        matterId: target.matter_id,
        forumId: target.forum_id,
        reason: 'matter_forum',
      });
    }
  }

  const report: MatchNoticesReport = { workspaces: 0, matches: 0 };
  for (const [workspaceId, values] of byWorkspace) {
    const inserted = await withWorkspace(deps.db, { workspaceId }, (tx) =>
      tx.insert(noticeMatch).values(values).onConflictDoNothing().returning({ id: noticeMatch.id }),
    );
    if (inserted.length > 0) report.workspaces += 1;
    report.matches += inserted.length;
  }
  return report;
}
