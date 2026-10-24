// Tagging news items to practice areas and forums (#481). The gateway tagger calls the `tag_news`
// task, whose output is two closed enum arrays (schema-validated, no free text), and filters the
// answer against the db lists again. The keyword tagger is the deterministic fallback for a global
// job that has no workspace to bill an AI call to.
import type { AiGateway, RunContext } from '@causedeck/ai';
import { schema } from '@causedeck/db';

import type { NewsTagger, NewsTags } from './types.ts';

const AREA_KEYWORDS: Readonly<Record<schema.NewsPracticeArea, readonly string[]>> = {
  civil: ['civil procedure', 'cpc', 'civil suit', 'injunction'],
  criminal: ['criminal', 'bail', 'ipc', 'bns', 'crpc', 'bnss', 'ndps', 'pmla'],
  constitutional: ['constitution', 'article 14', 'article 21', 'fundamental right', 'writ'],
  corporate: ['companies act', 'company law', 'sebi', 'merger', 'insolvent company'],
  tax: ['income tax', 'gst', 'customs', 'tax'],
  ibc: ['insolvency', 'ibc', 'bankruptcy', 'resolution professional'],
  arbitration: ['arbitration', 'arbitral', 'mediation'],
  family: ['divorce', 'maintenance', 'custody', 'matrimonial', 'family court'],
  labour: ['labour', 'labor', 'industrial dispute', 'epf', 'employee'],
  property: ['property', 'land acquisition', 'rera', 'tenancy', 'stamp duty'],
  ip: ['patent', 'trademark', 'copyright', 'intellectual property'],
  consumer: ['consumer'],
  environment: ['environment', 'pollution', 'forest', 'ngt'],
  banking: ['rbi', 'bank', 'sarfaesi', 'negotiable instrument', 'section 138'],
  service: ['service matter', 'pension', 'recruitment', 'cat '],
};

const FORUM_KEYWORDS: Readonly<Record<schema.NewsForum, readonly string[]>> = {
  supreme_court: ['supreme court', 'apex court', ' sc '],
  high_court: ['high court'],
  district_court: ['district court', 'sessions court', 'magistrate'],
  nclt: ['nclt'],
  nclat: ['nclat'],
  itat: ['itat'],
  drt: ['debt recovery tribunal', 'drt'],
  consumer_forum: ['consumer commission', 'consumer forum', 'ncdrc'],
  tribunal: ['tribunal'],
  regulator: ['sebi', 'rbi', 'irdai', 'trai', 'cci ', 'ministry', 'notification'],
};

function matching<K extends string>(
  haystack: string,
  table: Readonly<Record<K, readonly string[]>>,
): K[] {
  return (Object.keys(table) as K[]).filter((key) =>
    table[key].some((word) => haystack.includes(word)),
  );
}

/** Deterministic tagging by whole-word-ish keywords in the headline and excerpt. */
export function createKeywordTagger(): NewsTagger {
  return {
    tag({ title, excerpt }) {
      const haystack = ` ${`${title} ${excerpt ?? ''}`.toLowerCase()} `;
      return Promise.resolve({
        practiceAreas: matching(haystack, AREA_KEYWORDS),
        forums: matching(haystack, FORUM_KEYWORDS),
      });
    },
  };
}

interface TagOutput {
  practiceAreas: string[];
  forums: string[];
}

/** Keep only values of the closed lists, without repeats. */
export function closedTags(output: TagOutput): NewsTags {
  const areas = new Set<string>(schema.NEWS_PRACTICE_AREAS);
  const forums = new Set<string>(schema.NEWS_FORUMS);
  return {
    practiceAreas: [
      ...new Set(output.practiceAreas.filter((a) => areas.has(a))),
    ] as schema.NewsPracticeArea[],
    forums: [...new Set(output.forums.filter((f) => forums.has(f)))] as schema.NewsForum[],
  };
}

export function createGatewayNewsTagger(options: {
  gateway: AiGateway;
  scope: Pick<RunContext, 'workspaceId' | 'userId'>;
}): NewsTagger {
  const { gateway, scope } = options;
  return {
    async tag({ title, excerpt }) {
      const result = await gateway.run<TagOutput>(
        'tag_news',
        { title, ...(excerpt === null ? {} : { excerpt }) },
        { ...scope, purpose: 'news.tag' },
      );
      return closedTags(result.output);
    },
  };
}
