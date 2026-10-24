// Conflict-of-interest check (#500, D-048, counsel-gated by #486). Before taking a matter, the
// chamber checks the names on the new matter against the parties of its own matters: a new adverse
// party that is the chamber's client elsewhere, or a new client that is an adverse party elsewhere.
// It runs in the actor's workspace transaction over tenant tables only (FORCE RLS), so nothing from
// another workspace is visible and nothing leaves the workspace. A restricted matter the actor may
// not read is never shown. Every check writes one audit event holding counts, never names. The
// result is information for the advocate: nothing here blocks creating a matter.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { and, eq, inArray } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import { invalid } from '../shared/errors.ts';

import { nameSimilarity } from './normalize.ts';

const { matter, matterRestriction, member, person, roleEdge } = schema;

type Db = Database | Transaction;

const MAX_PARTIES = 20;
const MAX_NAME_LENGTH = 300;

/** Which side of the new matter a name is on. */
export type ConflictSide = 'client' | 'adverse';

export interface ConflictPartyInput {
  name: string;
  /** The chamber's client, or a party the new matter is against. */
  side: ConflictSide;
}

export interface ConflictHit {
  /** The name as given on the new matter. */
  checked: string;
  side: ConflictSide;
  matterId: string;
  matterTitle: string;
  /** The stored name or alias that matched. */
  matchedName: string;
  /** Where the match came from: the person's name or one of their aliases. */
  source: 'name' | 'alias';
  /** The chamber's role on that matter for the matched person. */
  existingRole: 'client' | 'adverse';
  /** 1 for the same name once spelling is normalised, lower for a near spelling. */
  score: number;
}

export interface ConflictCheckResult {
  hits: ConflictHit[];
  checked: number;
}

export interface ConflictActor {
  workspaceId: string;
  userId: string;
}

/** `represents` is the chamber's client on the matter; `opposes` is a party against it. */
const ROLE_OF_EDGE = { represents: 'client', opposes: 'adverse' } as const;

/** A conflict is the opposite role: our client opposed there, or an adverse party served here. */
const CONFLICTING_ROLE = { client: 'adverse', adverse: 'client' } as const;

export async function checkConflicts(
  deps: { db: Db },
  actor: ConflictActor,
  input: { parties: readonly ConflictPartyInput[] },
): Promise<ConflictCheckResult> {
  const parties = input.parties
    .map((p) => ({ name: p.name.trim(), side: p.side }))
    .filter((p) => p.name !== '');
  if (parties.length === 0) throw invalid('Enter at least one party name');
  if (parties.length > MAX_PARTIES) throw invalid('Too many parties to check');
  if (parties.some((p) => p.name.length > MAX_NAME_LENGTH)) throw invalid('A name is too long');

  return withWorkspace(deps.db, actor, async (tx) => {
    const rows = await tx
      .select({
        matterId: matter.id,
        title: matter.title,
        edgeKind: roleEdge.kind,
        name: person.name,
        aliases: person.aliases,
        ownerUserId: member.userId,
        allowUserIds: matterRestriction.allowedUserIds,
      })
      .from(roleEdge)
      .innerJoin(
        person,
        and(eq(person.workspaceId, roleEdge.workspaceId), eq(person.id, roleEdge.fromPersonId)),
      )
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, roleEdge.workspaceId), eq(matter.id, roleEdge.matterId)),
      )
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
      )
      .leftJoin(
        matterRestriction,
        and(
          eq(matterRestriction.workspaceId, matter.workspaceId),
          eq(matterRestriction.matterId, matter.id),
        ),
      )
      .where(
        and(
          eq(roleEdge.workspaceId, actor.workspaceId),
          inArray(roleEdge.kind, ['represents', 'opposes']),
        ),
      );

    const hits: ConflictHit[] = [];
    for (const row of rows) {
      const restricted = row.allowUserIds !== null;
      if (
        restricted &&
        row.ownerUserId !== actor.userId &&
        !row.allowUserIds?.includes(actor.userId)
      ) {
        continue;
      }
      const existingRole = ROLE_OF_EDGE[row.edgeKind as keyof typeof ROLE_OF_EDGE];
      for (const party of parties) {
        if (existingRole !== CONFLICTING_ROLE[party.side]) continue;
        const candidates = [
          { text: row.name, source: 'name' as const },
          ...row.aliases.map((text) => ({ text, source: 'alias' as const })),
        ];
        let best: { text: string; source: 'name' | 'alias'; score: number } | null = null;
        for (const candidate of candidates) {
          const score = nameSimilarity(party.name, candidate.text);
          if (score > 0 && (best === null || score > best.score)) best = { ...candidate, score };
        }
        if (best === null) continue;
        hits.push({
          checked: party.name,
          side: party.side,
          matterId: row.matterId,
          matterTitle: row.title,
          matchedName: best.text,
          source: best.source,
          existingRole,
          score: best.score,
        });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.matterTitle.localeCompare(b.matterTitle));

    await record(
      {
        db: tx,
        workspaceId: actor.workspaceId,
        actor: { userId: actor.userId, kind: 'user' },
      },
      {
        action: 'conflict.checked',
        metadata: {
          parties: parties.length,
          hits: hits.length,
          matters: new Set(hits.map((h) => h.matterId)).size,
        },
      },
    );
    return { hits, checked: parties.length };
  });
}
