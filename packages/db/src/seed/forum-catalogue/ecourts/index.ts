// The imported eCourts district establishments (#635): the committed, reviewed `snapshot.json`
// validated and mapped to A0 forum seeds. Empty until the cleared list lands (#640).
import { BENGALURU_DISTRICT } from '../bengaluru-district.ts';
import { CHENNAI_DISTRICT } from '../chennai-district.ts';

import snapshot from './snapshot.json' with { type: 'json' };
import { snapshotToForumSeeds, validateSnapshot } from './snapshot.ts';

export const ECOURTS_DISTRICT = snapshotToForumSeeds(validateSnapshot(snapshot), {
  skipCodes: new Set([...CHENNAI_DISTRICT, ...BENGALURU_DISTRICT].map((f) => f.code)),
});
