// Landing page copy (#90), i18n-ready: `en` is complete, `ta` and `kn` are stubs that fall back to
// `en` key by key until counsel-reviewed translations exist (#117). Public copy: CauseDeck is
// software for advocates, so it says what the software prepares and proposes and never claims
// outcomes, advice or action on the advocate's behalf. scripts/rule36-lint.ts scans this file.

export type LandingLocale = 'en' | 'ta' | 'kn';

export const POSITIONING_LINE =
  'CauseDeck is software for advocates. It does not provide legal services or legal advice, and it does not advertise or recommend any lawyer.';

export const SAMPLE_LABEL = 'Illustrative, sample data';

export interface LandingCopy {
  hero: {
    headline: string;
    subhead: string;
    primaryCta: string;
    secondaryCta: string;
    boardSummary: string;
  };
  problem: { heading: string; lines: string[] };
  loop: {
    heading: string;
    intro: string;
    beats: { id: string; title: string; body: string; sample: string }[];
  };
  provenance: { heading: string; body: string; quote: string; source: string; points: string[] };
  trust: {
    heading: string;
    intro: string;
    claims: { id: string; title: string; body: string; href: string }[];
    levels: { heading: string; items: { level: string; body: string }[] };
    undo: string;
  };
  courts: {
    heading: string;
    body: string;
    courts: { name: string; note: string }[];
    other: string;
  };
  faq: { heading: string; items: { id: string; q: string; a: string }[] };
  cta: { heading: string; body: string; primary: string; secondary: string };
}

const en: LandingCopy = {
  hero: {
    headline: 'Walk into court prepared.',
    subhead:
      "CauseDeck is software for advocates: it reads your cause lists and orders, builds tomorrow's briefs, and tracks every direction you owe.",
    primaryCta: 'Start free',
    secondaryCta: 'See how a court day runs',
    boardSummary:
      'A sample court day. Madras High Court and Karnataka High Court appear as columns. Each listing shows its item number, stage and time. A quoted line from a sample order shows the source of one direction, and a brief for the first listing sits behind the board. All names and case numbers are fictional.',
  },
  problem: {
    heading: 'The night before court',
    lines: ['Lists change at night.', 'Orders carry directions.', 'Juniors need context.'],
  },
  loop: {
    heading: 'A court day, in four beats',
    intro: 'The night before court is the hard part. CauseDeck makes it quiet.',
    beats: [
      {
        id: 'capture',
        title: 'Capture',
        body: 'Forward the cause lists and orders you already receive. CauseDeck reads them and proposes the listings and directions it found.',
        sample: 'Cause list, Madras High Court: 14 listings read, 2 changed overnight.',
      },
      {
        id: 'prepare',
        title: 'Prepare',
        body: 'Every listing gets a brief: the last order, what stands pending, and the lines you will want open. It prepares the brief and you read it before you rely on it.',
        sample: 'Brief for Item 14: last order, pending directions, two documents to carry.',
      },
      {
        id: 'execute',
        title: 'Execute',
        body: 'In court, the day sits on one board by hall, item and time. Your notes from the hearing become proposed entries for you to confirm.',
        sample: 'Proposed: next date 14.04.2026. Confirm or edit.',
      },
      {
        id: 'follow-up',
        title: 'Follow up',
        body: 'Each direction in an order becomes an entry with a due date and an owner. Nothing you owe the court or the client slips past quietly.',
        sample: 'Due in 4 weeks: counter affidavit, from the order of 12.03.2026.',
      },
    ],
  },
  provenance: {
    heading: 'Every fact shows where it came from',
    body: 'A date, a direction or a party name is never just a value. It carries the document, the page and the exact line it was read from, so you can check it in one tap.',
    quote: 'The respondents shall file a counter affidavit within four weeks.',
    source: 'Order dated 12.03.2026, page 2 (sample)',
    points: [
      'Proposed facts stay marked until you confirm them.',
      'Edits you make are marked as yours.',
      'A fact with no source cannot be shown.',
    ],
  },
  trust: {
    heading: 'You stay in control',
    intro: 'These are facts about the product, not promises about outcomes.',
    claims: [
      {
        id: 'india',
        title: 'Data stored in India',
        body: 'Your matters and documents are stored in India.',
        href: '/security/#data-in-india',
      },
      {
        id: 'ai',
        title: 'India-only AI by default',
        body: 'AI processing runs in India unless you choose otherwise.',
        href: '/security/#ai-processing',
      },
      {
        id: 'control',
        title: 'Nothing is sent or filed without you',
        body: 'CauseDeck prepares and proposes. You confirm, you send and you file.',
        href: '/security/#you-stay-in-control',
      },
      {
        id: 'training',
        title: 'No training on your data',
        body: 'Your documents are never used to train models.',
        href: '/security/#no-training',
      },
      {
        id: 'sources',
        title: 'Every fact shows its source',
        body: 'Each date and direction links back to the line it came from.',
        href: '/security/#sources',
      },
    ],
    levels: {
      heading: 'Levels of automation, in plain words',
      items: [
        { level: 'L1', body: 'It shows you what it found.' },
        { level: 'L2', body: 'It proposes a change and waits for you.' },
        { level: 'L3', body: 'It prepares a draft for you to read and edit.' },
        {
          level: 'L4',
          body: 'It prepares routine work in advance, and you review it before it counts.',
        },
      ],
    },
    undo: 'Changes you confirm can be undone for seven days.',
  },
  courts: {
    heading: 'The courts we start with',
    body: 'CauseDeck starts with the Madras High Court and the Karnataka High Court, built around how their cause lists and orders are actually written.',
    courts: [
      { name: 'Madras High Court', note: 'Principal Seat, Chennai, and the Madurai Bench.' },
      {
        name: 'High Court of Karnataka',
        note: 'Bengaluru, with its benches at Dharwad and Kalaburagi.',
      },
    ],
    other: 'For other forums, CauseDeck works from the documents you share with it.',
  },
  faq: {
    heading: 'Questions advocates ask',
    items: [
      {
        id: 'legal-advice',
        q: 'Is this legal advice?',
        a: 'No. CauseDeck is software for advocates. It does not give legal advice, it does not act for you, and it does not talk to your clients.',
      },
      {
        id: 'privacy',
        q: 'Who can see my matters?',
        a: 'Only the people in your workspace. Matters are kept apart from every other workspace, and nobody at CauseDeck reads your matters unless you invite a support session.',
      },
      {
        id: 'india-data',
        q: 'Where is my data stored?',
        a: 'In India. AI processing is India-only by default.',
      },
      {
        id: 'ai',
        q: 'What does the AI do, and what does it not do?',
        a: 'It reads documents, proposes entries and prepares briefs, each with its source. It does not send, file or commit to anything for you, and it does not invent citations.',
      },
      {
        id: 'training',
        q: 'Do you train on my documents?',
        a: 'No. Your documents are not used to train models.',
      },
    ],
  },
  cta: {
    heading: 'Make tomorrow quiet.',
    body: 'Start with the cause list you received tonight.',
    primary: 'Start free',
    secondary: 'Write to us',
  },
};

// Stubs: empty until counsel-reviewed translations exist; every key falls back to English.
const ta: Partial<LandingCopy> = {};
const kn: Partial<LandingCopy> = {};

export const LANDING: Record<LandingLocale, Partial<LandingCopy>> = { en, ta, kn };

/** Copy for a locale; missing keys fall back to English. */
export function landingCopy(locale: LandingLocale = 'en'): LandingCopy {
  return { ...en, ...LANDING[locale] };
}

export interface SampleItem {
  itemNo: number;
  hall: string;
  stage: 'listed' | 'reserved' | 'part-heard';
  time: string;
  caseNo: string;
  parties: string;
  changed?: boolean;
}

/** Fictional parties and case numbers in the nomenclature each court uses. */
export const SAMPLE_BOARD: { court: string; items: SampleItem[] }[] = [
  {
    court: 'Madras High Court',
    items: [
      {
        itemNo: 14,
        hall: 'Court Hall 12',
        stage: 'listed',
        time: '10:30',
        caseNo: 'W.P. No. 18423 of 2025',
        parties: 'Kaveri Mills Pvt. Ltd. v. The Commissioner of Customs',
        changed: true,
      },
      {
        itemNo: 31,
        hall: 'Court Hall 12',
        stage: 'part-heard',
        time: '14:15',
        caseNo: 'S.A. No. 207 of 2024',
        parties: 'R. Arul v. S. Meenakshi',
      },
    ],
  },
  {
    court: 'High Court of Karnataka',
    items: [
      {
        itemNo: 7,
        hall: 'Court Hall 4',
        stage: 'listed',
        time: '11:00',
        caseNo: 'W.P. No. 10231 of 2025 (GM-RES)',
        parties: 'Mallige Foods v. State of Karnataka',
      },
      {
        itemNo: 22,
        hall: 'Court Hall 4',
        stage: 'reserved',
        time: '15:30',
        caseNo: 'R.F.A. No. 455 of 2023',
        parties: 'Hemavathi v. Ravi Kumar',
      },
    ],
  },
];
