// Seeded Karnataka HC orders and FR / scrutiny-objection notices (#408), in the grammar the adapter
// reads (order-header.ts, direction-cues.ts, registry-events.ts, config/order-cues.ts), each with
// its truth: the order date and every date printed or derived from a printed date. A decoy
// earlier-order date is printed but left out of the truth dates, so emitting it counts as
// invented. Every party, advocate and judge is FICTIONAL. Test tooling only.
import { addDays, CASE_TYPES, int, isoDay, numeric, type GeneratedDocument } from './grammar.ts';
import { ADVOCATES, ORDER_JUDGES, PETITIONERS, pick, RESPONDENTS } from './names.ts';

const NUMBER_WORDS = ['two', 'three', 'four', 'six'] as const;
const MONTH_NAMES = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
] as const;

/** `14TH DAY OF NOVEMBER, 2026`, as an order's `DATED THIS THE` line prints it. */
function worded(iso: string): string {
  const [y, m, d] = iso.split('-');
  const day = Number(d);
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'ST'
      : day % 10 === 2 && day !== 12
        ? 'ND'
        : day % 10 === 3 && day !== 13
          ? 'RD'
          : 'TH';
  return `${String(day)}${suffix} DAY OF ${MONTH_NAMES[Number(m) - 1] ?? ''}, ${y ?? ''}`;
}

function orderCaseLine(random: () => number): string {
  const type = pick(random, CASE_TYPES);
  const number = String(random() < 0.17 ? int(random, 100_001, 109_999) : int(random, 1, 29_999));
  const line = `${type.title} NO. ${number} OF ${String(int(random, 2018, 2026))}`;
  return type.categories === undefined ? line : `${line} (${pick(random, type.categories)})`;
}

export function generateOrder(random: () => number, index: number): GeneratedDocument {
  const orderDate = isoDay(int(random, 0, 330));
  const dates = [orderDate];
  const lines = [
    'IN THE HIGH COURT OF KARNATAKA AT BENGALURU',
    '(FICTIONAL SYNTHETIC ORDER: every party, advocate and judge is fictional)',
    random() < 0.7
      ? `DATED THIS THE ${worded(orderDate)}`
      : `DATED: ${numeric(orderDate, pick(random, ['.', '-', '/']))}`,
    'BEFORE',
    pick(random, ORDER_JUDGES),
    orderCaseLine(random),
    'BETWEEN:',
    `${pick(random, PETITIONERS).toUpperCase()} ... PETITIONER`,
    `(BY ${pick(random, ADVOCATES).toUpperCase()}, ADVOCATE)`,
    'AND:',
    `${pick(random, RESPONDENTS).toUpperCase()} ... RESPONDENT`,
    'ORDER',
    'Heard the learned counsel on either side.',
  ];
  if (random() < 0.3) {
    // A decoy: an earlier order's date is printed but is neither the order date nor a next date.
    const earlier = isoDay(int(random, -2000, -30));
    lines.push(`The petitioner assails the impugned order dated ${numeric(earlier)}.`);
  }
  for (let cues = int(random, 0, 2); cues > 0; cues -= 1) {
    switch (int(random, 0, 4)) {
      case 0: {
        const next = addDays(orderDate, int(random, 7, 60));
        dates.push(next);
        lines.push(`${pick(random, ['List on', 'Call on', 'Post on'])} ${numeric(next)}.`);
        break;
      }
      case 1:
        lines.push(`List after ${pick(random, NUMBER_WORDS)} weeks.`);
        break;
      case 2:
        lines.push('Issue notice to the respondents.');
        break;
      case 3:
        lines.push(
          `Respondents to file statement of objections within ${pick(random, NUMBER_WORDS)} weeks.`,
        );
        break;
      default:
        lines.push('Interim order granted earlier is extended till the next date of hearing.');
    }
  }
  if (random() < 0.3) lines.push(`Neutral Citation No. 2026:KHC:${String(int(random, 1, 9999))}`);
  return {
    name: `order-${String(index + 1).padStart(3, '0')}`,
    kind: 'order',
    format: 'txt',
    content: `${lines.join('\n')}\n`,
    truth: { orderDate, dates },
  };
}

export function generateNotice(random: () => number, index: number): GeneratedDocument {
  const dated = random() < 0.8;
  const basis = isoDay(int(random, 0, 330));
  const weeks = random() < 0.3;
  const n = weeks ? int(random, 1, 3) : int(random, 3, 30);
  const lines = [
    'HIGH COURT OF KARNATAKA AT BENGALURU',
    'REGISTRY: SCRUTINY SECTION',
    '(FICTIONAL SYNTHETIC REGISTRY NOTICE: every name is fictional)',
    ...(dated ? [`Date of scrutiny: ${numeric(basis)}`] : []),
    `FR No. ${String(int(random, 1, 29_999))}/2026: ${pick(random, PETITIONERS)} vs ${pick(random, RESPONDENTS)}`,
    'Office objections: (1) court fee not paid; (2) index not filed.',
    `The defects are to be cured within ${String(n)} ${weeks ? 'weeks' : 'days'}.`,
  ];
  return {
    name: `notice-${String(index + 1).padStart(3, '0')}`,
    kind: 'registry_notice',
    format: 'txt',
    content: `${lines.join('\n')}\n`,
    truth: { dates: dated ? [basis, addDays(basis, weeks ? 7 * n : n)] : [] },
  };
}
