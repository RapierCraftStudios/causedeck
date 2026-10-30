// Legal NER by role (#892, D-053): finds the persons of a judgment (parties, witnesses, relatives and
// other persons) with rules over the cause title and the wording of the text, and the names that
// stay (judges and advocates). Pure and deterministic; low-confidence spans go to the gateway hook.
import {
  anyOf,
  escapeRe,
  HONORIFIC,
  NAME,
  PARTY_ROLES,
  trimName,
  tokensOf,
  ci,
} from './names.ts';

export type PersonRole =
  | 'petitioner'
  | 'appellant'
  | 'respondent'
  | 'accused'
  | 'complainant'
  | 'victim'
  | 'witness'
  | 'relative'
  | 'other';

export interface Entity {
  names: string[];
  tokens: Set<string>;
  role: PersonRole;
  /** For a relative: the role word or the entity the relation is to. */
  holder?: Entity | PersonRole | undefined;
  relation?: string | undefined;
  label: string;
}

const ROLE_OF: Record<string, PersonRole> = {
  petitioner: 'petitioner',
  applicant: 'petitioner',
  plaintiff: 'petitioner',
  appellant: 'appellant',
  respondent: 'respondent',
  defendant: 'respondent',
  accused: 'accused',
  complainant: 'complainant',
  informant: 'complainant',
  victim: 'victim',
  prosecutrix: 'victim',
  survivor: 'victim',
  witness: 'witness',
};
const PRIORITY: Record<PersonRole, number> = {
  petitioner: 1,
  appellant: 1,
  respondent: 1,
  accused: 1,
  complainant: 1,
  victim: 1,
  relative: 2,
  witness: 3,
  other: 4,
};
const RELATIONS = [
  'wife',
  'husband',
  'son',
  'daughter',
  'father',
  'mother',
  'brother',
  'sister',
  'father-in-law',
  'mother-in-law',
];
const PARENTAGE: Record<string, string> = {
  's/o': 'parent',
  'd/o': 'parent',
  'son of': 'parent',
  'daughter of': 'parent',
  'w/o': 'husband',
  'wife of': 'husband',
  'h/o': 'wife',
  'husband of': 'wife',
};

const ROLE_WORD = anyOf(PARTY_ROLES);
const REL_WORD = anyOf(RELATIONS);
const PARENT_WORD = '(?:[Ss]\\/[Oo]|[Dd]\\/[Oo]|[Ww]\\/[Oo]|[Hh]\\/[Oo]|[Ss]on of|[Dd]aughter of|[Ww]ife of|[Hh]usband of)';
const OPT_HON = `(?:${HONORIFIC}\\s+)?`;

const roleOf = (word: string): PersonRole => ROLE_OF[word.toLowerCase()] ?? 'other';

/** Judges and advocates: names that are kept, never redacted. */
export function collectKept(text: string, bench: readonly string[]): string[] {
  const kept = new Set<string>(bench.map((b) => b.trim()).filter((b) => b !== ''));
  const add = (raw: string | undefined) => {
    const n = raw === undefined ? null : trimName(raw);
    if (n !== null) kept.add(n);
  };
  const desig = `(?:learned\\s+)?(?:${anyOf(['senior', 'additional', 'standing', 'government', 'state', 'public', 'special', 'assistant', 'deputy', 'central', 'high', 'court'])}\\s+)*${anyOf(['advocate', 'counsel', 'pleader', 'prosecutor', 'general', 'solicitor'])}`;
  const patterns = [
    new RegExp(`\\b(?:Justice|JUSTICE|Judge|JUDGE)\\s+(?:${HONORIFIC}\\s+)?(${NAME})`, 'g'),
    new RegExp(`${OPT_HON}(${NAME})\\s*,?\\s*(?:the\\s+)?${desig}`, 'g'),
    new RegExp(`${desig}\\s+(?:for\\s+(?:the\\s+)?\\w+\\s*,?\\s*)?${OPT_HON}(${NAME})`, 'g'),
    new RegExp(`\\b${HONORIFIC}\\s+(${NAME})\\s+for\\s+(?:the\\s+)?${ROLE_WORD}`, 'g'),
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) add(m[1]);
  // Companies and other bodies keep their names even where a word in them is also a person's name.
  const body = /\b(?:M\/s\.?\s+)?((?:[A-Z][\w&.'-]*[ \t]+){1,6}(?:Private[ \t]+Limited|Pvt\.?[ \t]+Ltd\.?|Limited|Ltd\.?|Bank|Corporation|Company|Industries|Enterprises|Association|Society|Trust))\b/g;
  for (const m of text.matchAll(body)) {
    const raw = (m[1] ?? '').replace(/^(?:Sri|Shri|Smt|Mr|Mrs|Ms|Dr)\.?\s+/, '');
    kept.add(m[1] ?? raw);
    kept.add(raw);
  }
  return [...kept].filter((k) => k !== '');
}

const ABOVE_ALL = (a: Entity, b: PersonRole): boolean => PRIORITY[b] < PRIORITY[a.role];

class Registry {
  readonly entities: Entity[] = [];
  private readonly keptKeys: string[][];
  constructor(kept: readonly string[]) {
    this.keptKeys = kept.map(tokensOf);
  }

  isKept(name: string): boolean {
    const t = tokensOf(name);
    return this.keptKeys.some((k) => t.every((x) => k.includes(x)));
  }

  find(name: string): Entity | undefined {
    const t = tokensOf(name);
    if (t.length === 0) return undefined;
    return this.entities.find((e) => {
      const et = [...e.tokens];
      return t.every((x) => e.tokens.has(x)) || et.every((x) => t.includes(x));
    });
  }

  add(
    raw: string | undefined,
    role: PersonRole,
    holder?: Entity | PersonRole,
    relation?: string,
  ): Entity | undefined {
    const name = raw === undefined ? null : trimName(raw.replace(new RegExp(`^${HONORIFIC}\\s+`), ''));
    if (name === null || this.isKept(name)) return undefined;
    const known = this.find(name);
    if (known !== undefined) {
      if (!known.names.includes(name)) known.names.push(name);
      for (const t of tokensOf(name)) known.tokens.add(t);
      if (ABOVE_ALL(known, role)) {
        known.role = role;
        known.holder = holder;
        known.relation = relation;
      }
      return known;
    }
    const entity: Entity = {
      names: [name],
      tokens: new Set(tokensOf(name)),
      role,
      holder,
      relation,
      label: '',
    };
    this.entities.push(entity);
    return entity;
  }
}

/** The title-block lines: `RAMESH KUMAR S/O LATE RAJU ... PETITIONER`. */
function readTitleBlock(registry: Registry, firstPage: string): void {
  const roleEnd = new RegExp(
    `^\\s*(?:\\d+[.)]\\s*)?(.+?)[\\s.…,;:-]*\\(?\\s*(?:the\\s+)?(${ROLE_WORD})s?\\b\\s*(?:No\\.?\\s*\\d+)?\\)?[\\s.]*$`,
  );
  for (const line of firstPage.split('\n').slice(0, 80)) {
    if (line.length > 240) continue;
    const m = roleEnd.exec(line.replace(/^\s*(?:between|and)\s*:?\s*/i, ''));
    if (m === null) continue;
    const parts = (m[1] ?? '').split(new RegExp(`\\s*(${PARENT_WORD})\\.?\\s*`));
    const mainRaw = (parts[0] ?? '').replace(/,?\s*(?:aged|R\/o|resident).*$/i, '');
    if (!new RegExp(`^${OPT_HON}${NAME}$`).test(mainRaw.trim())) continue;
    const owner = registry.add(mainRaw, roleOf(m[2] ?? ''));
    for (let i = 1; i + 1 < parts.length && owner !== undefined; i += 2) {
      const rel = PARENTAGE[(parts[i] ?? '').toLowerCase().replace(/\s+/g, ' ')] ?? 'parent';
      const chunk = (parts[i + 1] ?? '').replace(/^(?:late\s+)/i, '').split(/,|\baged\b|R\/o|resident/i)[0];
      registry.add(chunk?.replace(new RegExp(`^${HONORIFIC}\\s+`), ''), 'relative', owner, rel);
    }
  }
}

export interface CollectOptions {
  bench: readonly string[];
  sensitive: boolean;
  extraNames: readonly string[];
}

/** Persons and kept names of one judgment, from its page texts. */
export function collectEntities(
  pages: readonly string[],
  opts: CollectOptions,
): { entities: Entity[]; kept: string[] } {
  const text = pages.join('\n');
  const kept = collectKept(text, opts.bench);
  const reg = new Registry(kept);

  readTitleBlock(reg, pages[0] ?? '');

  for (const m of text.matchAll(
    new RegExp(`(${NAME})\\s*\\(\\s*(?:hereinafter|herein\\s+after)\\s+(?:referred\\s+to\\s+as\\s+)?(?:the\\s+)?['"“‘]*(${ROLE_WORD})`, 'g'),
  )) {
    reg.add(m[1], roleOf(m[2] ?? ''));
  }

  // "X, wife of the Complainant" / "X, the son of Y"
  for (const m of text.matchAll(
    new RegExp(`${OPT_HON}(${NAME})\\s*,\\s*(?:the\\s+)?(${REL_WORD})\\s+of\\s+(?:the\\s+)?(?:(${ROLE_WORD})\\b|${OPT_HON}(${NAME}))`, 'g'),
  )) {
    const holder =
      m[3] !== undefined ? roleOf(m[3]) : m[4] === undefined ? undefined : (reg.add(m[4], 'other') ?? undefined);
    reg.add(m[1], 'relative', holder, (m[2] ?? '').toLowerCase());
  }
  // "the Complainant's wife Smt. X"
  for (const m of text.matchAll(
    new RegExp(`(?:the\\s+)?(${ROLE_WORD})['’]s\\s+(${REL_WORD})\\s*,?\\s*${OPT_HON}(${NAME})`, 'g'),
  )) {
    reg.add(m[3], 'relative', roleOf(m[1] ?? ''), (m[2] ?? '').toLowerCase());
  }
  // "X S/o Y", "X wife of Y"
  for (const m of text.matchAll(
    new RegExp(`${OPT_HON}(${NAME})\\s*,?\\s*(${PARENT_WORD})\\s*(?:[Ll]ate\\s+)?${OPT_HON}(${NAME})`, 'g'),
  )) {
    const owner = reg.add(m[1], 'other');
    const rel = PARENTAGE[(m[2] ?? '').toLowerCase().replace(/\s+/g, ' ')] ?? 'parent';
    reg.add(m[3], 'relative', owner, rel);
  }

  // "his wife Anitha Khan", "the father Rajesh"
  for (const m of text.matchAll(
    new RegExp(`\\b(?:${ci('his')}|${ci('her')}|${ci('their')}|${ci('the')})\\s+(${REL_WORD})\\s*,?\\s*${OPT_HON}(${NAME})`, 'g'),
  )) {
    reg.add(m[2], 'relative', undefined, (m[1] ?? '').toLowerCase());
  }

  // "the accused Ramesh", "Petitioner No. 2 Smt. Lakshmi"
  for (const m of text.matchAll(
    new RegExp(`(?:\\bthe\\s+|\\bThe\\s+)?\\b(${ROLE_WORD})(?:\\s+No\\.?\\s*\\d+)?\\s*,?\\s*(?:(?:namely|named|by\\s+name)\\s+)?${OPT_HON}(${NAME})`, 'g'),
  )) {
    reg.add(m[2], roleOf(m[1] ?? ''));
  }

  // "PW-1 Ramesh", "witness Ramesh"
  for (const m of text.matchAll(
    new RegExp(`(?:\\b(?:PW|DW|CW)[- ]?\\d+|\\b${ci('witness')}(?:es)?)\\s*[:,-]?\\s*${OPT_HON}(${NAME})`, 'g'),
  )) {
    reg.add(m[1], 'witness');
  }

  if (opts.sensitive) {
    for (const m of text.matchAll(
      new RegExp(`\\b(?:${ci('minor')}|${ci('child')})\\s+(?:${anyOf(['girl', 'boy', 'daughter', 'son'])}\\s*,?\\s*)?${OPT_HON}(${NAME})`, 'g'),
    )) {
      reg.add(m[1], 'victim');
    }
  }

  for (const m of text.matchAll(new RegExp(`\\b${HONORIFIC}\\s+(${NAME})`, 'g'))) {
    reg.add(m[1], 'other');
  }
  for (const n of opts.extraNames) reg.add(n, 'other');

  assignLabels(reg.entities);
  return { entities: reg.entities, kept };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Role placeholders: stable within a judgment, in order of first appearance. */
function assignLabels(entities: Entity[]): void {
  const count = (role: PersonRole) => entities.filter((e) => e.role === role).length;
  const seen = new Map<PersonRole, number>();
  for (const e of entities) {
    if (e.role === 'relative') continue;
    const n = (seen.get(e.role) ?? 0) + 1;
    seen.set(e.role, n);
    const many = count(e.role) > 1;
    if (e.role === 'witness') e.label = `Witness ${n}`;
    else if (e.role === 'other') e.label = `Person ${n}`;
    else e.label = many ? `${cap(e.role)} ${n}` : `the ${cap(e.role)}`;
  }
  const dup = new Map<string, number>();
  let loose = 0;
  for (const e of entities) {
    if (e.role !== 'relative') continue;
    const h = e.holder;
    const base =
      h === undefined
        ? undefined
        : typeof h === 'string'
          ? `the ${cap(h)}`
          : h.label !== ''
            ? h.label
            : undefined;
    if (base === undefined || e.relation === undefined) {
      loose += 1;
      e.label = `Relative ${loose}`;
      continue;
    }
    const label = `${base}'s ${e.relation}`;
    const n = (dup.get(label) ?? 0) + 1;
    dup.set(label, n);
    e.label = n === 1 ? label : `${label} ${n}`;
  }
}

export { escapeRe };
