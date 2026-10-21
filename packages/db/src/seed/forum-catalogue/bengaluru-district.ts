// Bengaluru Urban district courts (#34, docs/strategy/11 §2.1): A0 forums under one district adapter
// id. English first with Kannada (Karnataka Act 13 of 2023 for trial courts and tribunals). One
// eCourts district site (`bengaluru.dcourts.gov.in`, research/raw/09 §2.1) serves every complex and
// establishment, labour courts and industrial tribunals included, from one cause-list page whose
// official path has a fraction slash (U+2044), stored percent-encoded.
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
  court: 'Bengaluru Urban District Courts',
  seat: 'Bengaluru',
  side: 'not_applicable',
  languageProfile: { primary: 'en', secondary: ['kn'], ocr: ['kn', 'en'] },
  adapterId: 'in.ka.bengaluru-urban.district',
  adapterLevel: 'A0',
  enabled: true,
  config: {
    hosts: ['bengaluru.dcourts.gov.in'],
    deepLinks: { cause_list: 'cause-list-%E2%81%84-daily-board/' },
    notes: 'The cause-list form asks for the court complex or establishment and two captchas.',
  },
};

export const BENGALURU_DISTRICT: readonly ForumSeed[] = [
  {
    ...DISTRICT,
    code: 'in.ka.bengaluru-urban.city-civil-sessions',
    establishment: 'City Civil and Sessions Court',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.ka.bengaluru-urban.cmm-courts',
    establishment: 'Chief Metropolitan Magistrate Courts',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.ka.bengaluru-urban.mayo-hall',
    establishment: 'Mayo Hall Court Complex',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.ka.bengaluru-urban.small-causes',
    establishment: 'Court of Small Causes',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.ka.bengaluru-urban.family-court',
    establishment: 'Family Court',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.ka.bengaluru-urban.commercial-courts',
    establishment: 'Commercial Courts',
    jurisdictionKind: 'district',
  },
  {
    ...DISTRICT,
    code: 'in.ka.bengaluru-urban.labour-courts',
    establishment: 'Labour Courts',
    jurisdictionKind: 'tribunal',
  },
  {
    ...DISTRICT,
    code: 'in.ka.bengaluru-urban.industrial-tribunals',
    establishment: 'Industrial Tribunals',
    jurisdictionKind: 'tribunal',
  },
];
