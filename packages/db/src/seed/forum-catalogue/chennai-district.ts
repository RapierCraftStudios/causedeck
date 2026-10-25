// Chennai subordinate courts (#34, docs/strategy/11 §2.2): A0 forums under one district adapter id,
// Tamil-first (TN Official Language Act). The Chennai district site was unreachable in research
// (research/raw/08 §13), so only the national eCourts services host, linked from the Madras HC home
// page, is listed; no page of it was verified per complex, so there are no deep-link templates yet.
import type { ForumSeed } from '@causedeck/validators/forum';

const DISTRICT: Pick<
  ForumSeed,
  | 'court'
  | 'seat'
  | 'side'
  | 'languageProfile'
  | 'adapterId'
  | 'adapterLevel'
  | 'enabled'
  | 'config'
> = {
  court: 'Chennai District Courts',
  seat: 'Chennai',
  side: 'not_applicable',
  languageProfile: { primary: 'ta', secondary: ['en'], ocr: ['ta', 'en'] },
  adapterId: 'in.tn.chennai.district',
  adapterLevel: 'A0',
  enabled: true,
  config: {
    hosts: ['services.ecourts.gov.in'],
    deepLinks: {},
    notes: 'District eCourts services; cause lists and case status sit behind a captcha.',
  },
};

export const CHENNAI_DISTRICT: readonly ForumSeed[] = [
  {
    ...DISTRICT,
    code: 'in.tn.chennai.city-civil-court',
    establishment: 'City Civil Court, Chennai',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.tn.chennai.small-causes',
    establishment: 'Court of Small Causes, Chennai',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.tn.chennai.cmm-egmore',
    establishment: 'Chief Metropolitan Magistrate Court, Egmore',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.tn.chennai.family-courts',
    establishment: 'Family Courts, Chennai',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.tn.chennai.commercial-court-egmore',
    establishment: 'Commercial Court, Egmore',
    jurisdictionKind: 'district',
  },
];
