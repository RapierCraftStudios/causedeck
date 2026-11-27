// The full-text query of the matter copilot's document pages (#1182): stop and question words are
// dropped and the remaining terms are OR'd as prefixes, never AND'd.
import { randomUUID } from 'node:crypto';

import { createEmbedGateway, createMockEmbedProvider } from '@causedeck/ai';
import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { corpusSources, tsQueryOf } from '../sources.ts';

const BAIL =
  'What does a court weigh when granting regular bail, and what did the Supreme Court say about delay in trial?';

describe('tsQueryOf', () => {
  it('drops stop words and ORs the remaining prefix terms', () => {
    const query = tsQueryOf(BAIL);
    const terms = query?.split(' | ') ?? [];
    for (const stop of ['what:*', 'does:*', 'did:*', 'say:*', 'the:*', 'and:*'])
      expect(terms).not.toContain(stop);
    expect(terms).toEqual(
      expect.arrayContaining([
        'weigh:*',
        'granting:*',
        'regular:*',
        'bail:*',
        'delay:*',
        'trial:*',
      ]),
    );
    expect(query).not.toContain('&');
  });

  it('is null when only stop words are left', () => {
    expect(tsQueryOf('what did they say about it')).toBeNull();
  });
});

const HF_ATTRIBUTION = 'Dattam Labs via overthelex/indian-court-decisions, CC-BY-4.0';

async function seedJudgment(
  tx: Transaction,
  text: string,
  v: { pinpointState?: 'verified' | 'pending-pdf'; attribution?: string } = {},
): Promise<string> {
  const sha256 = randomUUID().replaceAll('-', '');
  const [row] = await tx
    .insert(schema.judgment)
    .values({
      sourceId: 'in.mhc.judgments',
      court: 'MHC',
      sha256,
      neutralCitation: `2019:MHC:${sha256.slice(0, 5)}`,
      judgmentDate: '2019-03-04',
      provenance: {
        url: `https://court.example/${sha256}.pdf`,
        fetchedAt: '2026-10-23T00:00:00.000Z',
        sha256,
        sourceId: 'in.mhc.judgments',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      },
      pageText: [{ pageNo: 1, text }],
      redactedText: [{ pageNo: 1, text }],
      redactionVersion: 1,
      segmentVersion: 1,
      segmentedRedactionVersion: 1,
      caseTitle: 'State v. Ravi',
      courtLevel: 'high_court',
      ...(v.pinpointState === undefined ? {} : { pinpointState: v.pinpointState }),
      ...(v.attribution === undefined ? {} : { attribution: v.attribution }),
    })
    .returning({ id: schema.judgment.id });
  const judgmentId = row?.id ?? '';
  const embedder = createMockEmbedProvider();
  const { vectors } = await embedder.embed([text]);
  await tx.insert(schema.judgmentSegment).values({
    judgmentId,
    ordinal: 1,
    role: 'reasoning',
    pageFrom: 1,
    pageTo: 1,
    text,
    court: 'MHC',
    courtLevel: 'high_court',
    judgmentYear: 2019,
    embedding: vectors[0] ?? [],
    embeddingModel: embedder.modelVersion,
  });
  return judgmentId;
}

describe('corpusSources', () => {
  it('carries pinpointState and attribution of a pending-pdf judgment, and neither label for a verified one (#1172)', async () => {
    await withTestDb(async (tx) => {
      const pending = await seedJudgment(
        tx,
        'Zygomorphic quarry blasting caused cracks in the neighbouring tenement walls.',
        { pinpointState: 'pending-pdf', attribution: HF_ATTRIBUTION },
      );
      const verified = await seedJudgment(
        tx,
        'Zygomorphic quarry blasting damaged the tenement and the licence was cancelled.',
      );
      const { judgments } = await corpusSources(tx, 'zygomorphic quarry blasting tenement', {
        embed: createEmbedGateway({ providers: [createMockEmbedProvider()] }),
      });
      expect(judgments[pending]?.pinpointState).toBe('pending-pdf');
      expect(judgments[pending]?.attribution).toBe(HF_ATTRIBUTION);
      expect(judgments[verified]?.pinpointState).toBe('verified');
      expect(judgments[verified]?.attribution).toBeNull();
    });
  });
});
