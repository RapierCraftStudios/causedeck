import type {
  AdapterStatus,
  CourtsIndex,
  CourtsIndexForum,
  DisabledForum,
  Forum,
  ForumDetail,
  HallSeen,
} from '@causedeck/core/court';

import type { BenchChangeItem } from '../bench-change-banner.tsx';
import type { RosterForumOption } from '../roster-forum-picker.tsx';
import type { RosterCardData, RosterHallRow } from '../roster-table.tsx';

/** A Madras HC-like forum; override what a case needs. */
export function forum(overrides: Partial<CourtsIndexForum> = {}): CourtsIndexForum {
  const code = overrides.code ?? 'in.tn.madras-hc.principal.appellate';
  return {
    id: `id-${code}`,
    code,
    court: 'Madras High Court',
    establishment: 'Principal Seat, Appellate Side',
    seat: 'Chennai',
    side: 'appellate',
    languageProfile: { primary: 'en' },
    adapterId: 'in.tn.madras-hc.principal',
    adapterLevel: 'A1',
    workspaceOwned: false,
    latestParse: null,
    officialList: {
      url: 'https://court.example/cause_list.php',
      fallbacks: [],
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    ...overrides,
  };
}

export function disabledForum(overrides: Partial<DisabledForum> = {}): DisabledForum {
  return {
    id: 'id-madurai',
    code: 'in.tn.madras-hc.madurai',
    court: 'Madras High Court',
    establishment: 'Madurai Bench',
    seat: 'Madurai',
    reason: 'Needs its own adapter configuration.',
    ...overrides,
  };
}

/** Bengaluru (two courts) and Chennai (one court, three forums), plus three planned forums. */
export function sampleIndex(): CourtsIndex {
  const chennai = [
    forum({
      code: 'in.tn.madras-hc.principal.original',
      establishment: 'Principal Seat, Original Side',
      side: 'original',
    }),
    forum(),
    forum({ code: 'in.tn.madras-hc.extra', establishment: 'Extra Bench', side: 'not_applicable' }),
  ];
  return {
    cities: [
      {
        city: 'Bengaluru',
        courts: [
          {
            court: 'Karnataka High Court',
            forums: [
              forum({
                code: 'in.ka.karnataka-hc.bengaluru',
                court: 'Karnataka High Court',
                establishment: 'Principal Bench',
                seat: 'Bengaluru',
                side: 'not_applicable',
                adapterLevel: 'A0',
                languageProfile: { primary: 'en', secondary: ['kn'] },
              }),
            ],
          },
          {
            court: 'City Civil Court',
            forums: [
              forum({
                code: 'in.ka.bengaluru.city-civil',
                court: 'City Civil Court',
                establishment: null,
                seat: 'Bengaluru',
                side: 'not_applicable',
                adapterLevel: 'A0',
              }),
            ],
          },
        ],
      },
      { city: 'Chennai', courts: [{ court: 'Madras High Court', forums: chennai }] },
    ],
    disabled: [
      disabledForum(),
      disabledForum({
        id: 'id-dharwad',
        code: 'in.ka.karnataka-hc.dharwad',
        court: 'Karnataka High Court',
        establishment: 'Dharwad Bench',
        seat: 'Dharwad',
      }),
      disabledForum({
        id: 'id-kalaburagi',
        code: 'in.ka.karnataka-hc.kalaburagi',
        court: 'Karnataka High Court',
        establishment: 'Kalaburagi Bench',
        seat: 'Kalaburagi',
        reason: null,
      }),
    ],
  };
}

const newWindow = (url: string) => ({
  url,
  fallbacks: [],
  target: '_blank' as const,
  rel: 'noopener noreferrer' as const,
});

/** The Madras HC appellate forum row as `getForum` returns it (#400). */
export function forumRow(overrides: Partial<Forum> = {}): Forum {
  return {
    id: 'id-in.tn.madras-hc.principal.appellate',
    workspaceId: null,
    code: 'in.tn.madras-hc.principal.appellate',
    court: 'Madras High Court',
    establishment: 'Principal Seat, Appellate Side',
    seat: 'Chennai',
    side: 'appellate',
    jurisdictionKind: 'high_court',
    languageProfile: { primary: 'en', secondary: ['ta'] },
    adapterId: 'in.tn.madras-hc.principal',
    adapterLevel: 'A1',
    config: {},
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Cause list (no captcha), case status (captcha-gated); a noted and an unreviewed access mode. */
export function forumDetail(overrides: Partial<ForumDetail> = {}): ForumDetail {
  return {
    forum: forumRow(),
    deepLinks: [
      {
        kind: 'cause_list',
        link: newWindow('https://court.example/cause_list.php'),
        captchaGated: false,
      },
      {
        kind: 'case_status',
        link: newWindow('https://court.example/case_status.php'),
        captchaGated: true,
      },
    ],
    accessModes: [
      {
        resource: 'case-status',
        mode: 'user_supplied',
        enabled: true,
        counselNote: 'The lawyer shares the list; nothing is fetched.',
        legalReviewPending: false,
      },
      {
        resource: 'sanctioned-push',
        mode: 'official',
        enabled: false,
        counselNote: null,
        legalReviewPending: true,
      },
    ],
    ...overrides,
  };
}

export function adapterStatus(overrides: Partial<AdapterStatus> = {}): AdapterStatus {
  return {
    adapterId: 'in.tn.madras-hc.principal',
    activeVersion: '1.2.0',
    level: 'A1',
    lastVerifiedAt: new Date('2026-10-01T06:30:00Z'),
    health: 'degraded',
    lastParse: {
      at: new Date('2026-10-21T04:00:00Z'),
      status: 'degraded',
      rowsParsed: 120,
      rowsAnchored: 14,
      hallsUnreadable: ['7', '12A'],
    },
    ...overrides,
  };
}

/** Halls 2 and 12A read, 7 unreadable in its newest list. */
export function hallsSeen(): HallSeen[] {
  return [
    { hallNo: '2', lastListAt: new Date('2026-10-21T04:00:00Z'), unreadable: false },
    { hallNo: '7', lastListAt: new Date('2026-10-21T04:00:00Z'), unreadable: true },
    { hallNo: '12A', lastListAt: new Date('2026-10-20T04:00:00Z'), unreadable: false },
  ];
}

/** Two roster versions of a forum: the active one from 5 Oct (in force) and September's. */
export function rosterCards(): RosterCardData[] {
  return [
    {
      id: 'roster-oct',
      version: 2,
      status: 'active',
      effectiveFrom: '2026-10-05',
      effectiveTo: null,
      entryCount: 3,
    },
    {
      id: 'roster-sep',
      version: 1,
      status: 'superseded',
      effectiveFrom: '2026-09-01',
      effectiveTo: '2026-10-05',
      entryCount: 2,
    },
  ];
}

/** The halls of the October roster, by hall number; hall 12A has no judge recorded. */
export function rosterHalls(): RosterHallRow[] {
  return [
    {
      entryId: 'entry-2',
      hallNo: '2',
      portfolioText: 'Writ petitions (2019 onwards)',
      benchLabel: 'Justice A. Venpa (fictional)',
    },
    {
      entryId: 'entry-7',
      hallNo: '7',
      portfolioText: 'Civil revision petitions; second appeals',
      benchLabel: 'Justice B. Kural (fictional), Justice C. Ilai (fictional)',
    },
    { entryId: 'entry-12a', hallNo: '12A', portfolioText: '', benchLabel: null },
  ];
}

/** Two open bench-change alerts; the second matter had no bench under the previous roster. */
export function benchChanges(): BenchChangeItem[] {
  return [
    {
      alertId: 'alert-1',
      matterId: 'matter-1',
      matterTitle: 'Raman v. State (fictional)',
      effectiveFrom: '2026-10-05',
      oldBench: { label: 'Justice A. Venpa (fictional)' },
      newBench: { label: 'Justice B. Kural (fictional), Justice C. Ilai (fictional)' },
    },
    {
      alertId: 'alert-2',
      matterId: 'matter-2',
      matterTitle: 'Lakshmi Traders v. Kumar (fictional)',
      effectiveFrom: '2026-10-05',
      oldBench: null,
      newBench: { label: null },
    },
  ];
}

/** Forums with rosters, for the forum picker. */
export function rosterForums(): RosterForumOption[] {
  return [
    { code: 'in.tn.madras-hc.principal.appellate', court: 'Madras High Court', seat: 'Chennai' },
    { code: 'in.ka.karnataka-hc.bengaluru', court: 'High Court of Karnataka', seat: 'Bengaluru' },
  ];
}
