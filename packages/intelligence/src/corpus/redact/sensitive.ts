// Sensitive-category detection (#892, D-053): POCSO, sexual offences (BNS ss.63-72, IPC 375-376,
// 228A), the JJ Act, matrimonial and family matters, in-camera proceedings and acquittals of
// individuals. Read from the title and the statutes and wording of the judgment, never guessed.

export const SENSITIVE_CATEGORIES = [
  'pocso',
  'sexual_offence',
  'juvenile',
  'matrimonial',
  'in_camera',
  'acquittal',
] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

const POCSO = /\bPOCSO\b|Protection\s+of\s+Children\s+from\s+Sexual\s+Offences/i;
const BNS_SEXUAL =
  /\b(?:sections?|ss?\.?)\s*(?:6[3-9]|7[0-2])\b[^.\n]{0,80}?\b(?:BNS|Bharatiya\s+Nyaya\s+Sanhita)\b|\b(?:BNS|Bharatiya\s+Nyaya\s+Sanhita)\b[^.\n]{0,40}?\b(?:sections?|ss?\.?)\s*(?:6[3-9]|7[0-2])\b/i;
const IPC_SEXUAL =
  /\b(?:sections?|ss?\.?)\s*(?:375|376(?:[A-E]|\(\d\))?|228A)\b[^.\n]{0,80}?\b(?:IPC|Indian\s+Penal\s+Code)\b|\b(?:IPC|Indian\s+Penal\s+Code)\b[^.\n]{0,40}?\b(?:sections?|ss?\.?)\s*(?:375|376(?:[A-E])?|228A)\b/i;
const JUVENILE =
  /Juvenile\s+Justice|\bJJ\s+Act\b|child\s+in\s+conflict\s+with\s+(?:the\s+)?law|Juvenile\s+Justice\s+Board/i;
const MATRIMONIAL =
  /Hindu\s+Marriage\s+Act|Special\s+Marriage\s+Act|Domestic\s+Violence|Family\s+Courts?\s+Act|Guardians\s+and\s+Wards|\bdivorce\b|restitution\s+of\s+conjugal|\bsection\s+498-?A\b|Hindu\s+Adoptions\s+and\s+Maintenance|custody\s+of\s+(?:the\s+)?(?:minor|child)|\bmatrimonial\b/i;
const IN_CAMERA = /\bin[\s-]camera\b/i;
const ACQUITTAL =
  /\b(?:is|are|stands?|shall\s+be|hereby)\s+acquitted\b|\bacquit(?:s)?\s+the\s+(?:accused|appellant)|\bacquittal\s+(?:of|recorded)\b/i;

/**
 * How much of the first page counts as the head for matrimonial detection (#1188): the cause title,
 * case type and the statute the case arises under; recitals and cited precedents sit deeper.
 */
const MATRIMONIAL_HEAD_CHARS = 4000;

/** The sensitive category of a judgment, or null. The most protective category wins. */
export function detectSensitiveCategory(
  title: string | null,
  pages: readonly string[],
): SensitiveCategory | null {
  const head = [title ?? '', ...pages.slice(0, 2)].join('\n');
  const all = pages.join('\n');
  if (POCSO.test(head) || POCSO.test(all)) return 'pocso';
  if (BNS_SEXUAL.test(all) || IPC_SEXUAL.test(all)) return 'sexual_offence';
  if (JUVENILE.test(all)) return 'juvenile';
  // Matrimonial is a property of the case (its type and statute), read from the title and the head
  // of the first page only: a passing mention of divorce or s.498A in the body is not enough (#1188).
  const matrimonialHead = [title ?? '', (pages[0] ?? '').slice(0, MATRIMONIAL_HEAD_CHARS)].join(
    '\n',
  );
  if (MATRIMONIAL.test(matrimonialHead)) return 'matrimonial';
  if (IN_CAMERA.test(all)) return 'in_camera';
  // An acquittal is read from the operative end of the judgment, not from a recital of the trial.
  const tail = all.slice(Math.floor(all.length * 0.6));
  if (ACQUITTAL.test(tail)) return 'acquittal';
  return null;
}
