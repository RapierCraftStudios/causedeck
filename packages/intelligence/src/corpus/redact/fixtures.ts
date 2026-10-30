// The labelled evaluation set (#892): 40 synthetic judgments built from templates over name pools,
// each with the persons that must disappear and the judges, advocates and bodies that must stay.
// Synthetic because real labelled fixtures (#119) are still being collected by hand; the report
// says so. Names are invented; the templates vary the cue wording, name forms and structure.
import type { SensitiveCategory } from './sensitive.ts';

export interface LabelledJudgment {
  id: string;
  kind: string;
  pages: string[];
  /** Name strings that appear in the text and must not survive redaction. */
  persons: string[];
  /** Judges, advocates, courts, bodies and statutes that must survive. */
  keep: string[];
  sensitive: SensitiveCategory | null;
  /** Identifiers of a victim or minor that must not survive (sensitive fixtures). */
  victimIdentifiers: string[];
}

const FIRST = ['Ramesh', 'Suresh', 'Lakshmi', 'Anitha', 'Prakash', 'Mohan', 'Geetha', 'Venkatesh', 'Shobha', 'Manjunath', 'Farhan', 'Salma', 'Arjun', 'Kavitha', 'Harish', 'Meena', 'Rajesh', 'Sunita', 'Naveen', 'Divya', 'Imran', 'Rukmini', 'Dinesh', 'Pooja'];
const SUR = ['Rao', 'Reddy', 'Naidu', 'Gowda', 'Iyer', 'Nair', 'Menon', 'Sharma', 'Verma', 'Singh', 'Patel', 'Shetty', 'Kulkarni', 'Joshi', 'Pillai', 'Banerjee', 'Khan', 'Ansari', 'Fernandes', 'Mathew', 'Thomas', 'Hegde', 'Murthy', 'Bhat'];
const JUDGES = ['Suraj Govindaraj', 'Krishna Dixit', 'Ashok Kinagi', 'Srishananda Bellur', 'Hemant Chandangoudar', 'Sathyanarayan Pandey', 'Devdas Raghunath', 'Anitha Sundaram'];
const ADVOCATES = ['Kiran Raghavan', 'Deepa Venugopal', 'Sandeep Chitnis', 'Rohini Mudgal', 'Ganesh Prabhu', 'Tara Mehrotra', 'Vivek Chandran', 'Neeta Salian'];
const PLACES = ['Hubballi', 'Mysuru', 'Mangaluru', 'Belagavi', 'Tumakuru', 'Chennai', 'Madurai', 'Salem'];

// Distinct people per fixture: the index walks the pools with co-prime steps.
const person = (i: number, k: number): { full: string; first: string; sur: string } => {
  const first = FIRST[(i * 5 + k * 7) % FIRST.length] ?? 'Ramesh';
  const sur = SUR[(i * 11 + k * 5 + 3) % SUR.length] ?? 'Rao';
  return { full: `${first} ${sur}`, first, sur };
};
const judge = (i: number): string => JUDGES[i % JUDGES.length] ?? JUDGES[0]!;
const advocate = (i: number, k: number): string => ADVOCATES[(i + k * 3) % ADVOCATES.length] ?? ADVOCATES[0]!;

const header = (i: number, caseType: string): string =>
  `IN THE HIGH COURT OF KARNATAKA AT BENGALURU\nDATED THIS THE ${10 + (i % 18)}TH DAY OF MARCH 2025\nBEFORE\nTHE HON'BLE MR. JUSTICE ${judge(i).toUpperCase()}\n${caseType} No. ${1000 + i} of 2024`;

function criminalAppeal(i: number): LabelledJudgment {
  const a = person(i, 1);
  const f = person(i, 2);
  const c = person(i, 3);
  const w = person(i, 4);
  const place = PLACES[i % PLACES.length];
  const caps = i % 2 === 0;
  const name = caps ? a.full.toUpperCase() : a.full;
  const p1 = `${header(i, 'CRIMINAL APPEAL')}
BETWEEN:
${name} S/o Late ${f.full}, aged 41 years, R/o ${place}, Karnataka 560001 ... APPELLANT
(By Sri. ${advocate(i, 1)}, Advocate)
AND:
State of Karnataka by the Station House Officer, ${place} Police Station ... RESPONDENT
(By Sri. ${advocate(i, 2)}, Additional State Public Prosecutor)
This appeal is filed under Section 374(2) of the Code of Criminal Procedure against the judgment dated 5.1.2024.`;
  const p2 = `The case of the prosecution is that the complainant ${c.full} lodged a complaint on 3.2.2022 alleging that ${a.first} had cheated him of Rs. 4,50,000. PW-1 ${c.full} deposed accordingly. PW-2 ${w.full} turned hostile. ${a.first} denied the charge. Mobile number 98450 12345 and email ${a.first.toLowerCase()}@example.com were produced. The vehicle KA 05 MN 1234 was seized. Account No. 123456789012 was frozen.`;
  const p3 = `Learned counsel ${advocate(i, 1)} submits that ${a.full} is innocent and ${w.first} is an interested witness. ${advocate(i, 2)}, learned counsel for the State, opposes. Having heard, the court finds that ${a.sur} was rightly convicted under Section 420 of the Indian Penal Code. The appeal is dismissed.`;
  return {
    id: `crl-appeal-${i}`,
    kind: 'criminal appeal',
    pages: [p1, p2, p3],
    persons: [a.full, f.full, c.full, w.full, a.first, w.first, a.sur, '98450 12345', `${a.first.toLowerCase()}@example.com`, 'KA 05 MN 1234', '123456789012'],
    keep: [judge(i), advocate(i, 1), advocate(i, 2), 'State of Karnataka', 'Section 420 of the Indian Penal Code', '3.2.2022', 'Rs. 4,50,000'],
    sensitive: null,
    victimIdentifiers: [],
  };
}

function civilSuit(i: number): LabelledJudgment {
  const d = person(i, 1);
  const w = person(i, 2);
  const co = ['Sri Lakshmi Textiles Private Limited', 'Karnataka State Financial Corporation', 'Canara Bank'][i % 3] ?? 'Canara Bank';
  const p1 = `${header(i, 'REGULAR FIRST APPEAL')}
BETWEEN:
${co} ... PLAINTIFF
(By Smt. ${advocate(i, 1)}, Advocate)
AND:
${d.full} ... DEFENDANT
(By Sri. ${advocate(i, 2)}, Advocate)`;
  const p2 = `The plaintiff claims Rs. 12,00,000 due under a loan agreement dated 7.8.2019. DW-1 ${w.full} was examined. The defendant ${d.full}, residing at 14, MG Road, Mysuru, admitted the signature. ${d.first} contends that limitation expired.`;
  const p3 = `Counsel ${advocate(i, 2)} relies on Article 137 of the Limitation Act. ${d.sur} failed to prove payment. The suit is decreed against ${d.full} with costs.`;
  return {
    id: `civil-${i}`,
    kind: 'civil suit',
    pages: [p1, p2, p3],
    persons: [d.full, w.full, d.first, d.sur, '14, MG Road, Mysuru'],
    keep: [judge(i), advocate(i, 1), advocate(i, 2), co, 'Article 137 of the Limitation Act', 'Rs. 12,00,000', '7.8.2019'],
    sensitive: null,
    victimIdentifiers: [],
  };
}

function bailWithRelative(i: number): LabelledJudgment {
  const p = person(i, 1);
  const c = person(i, 2);
  const wf = person(i, 3);
  const p1 = `${header(i, 'CRIMINAL PETITION')}
BETWEEN:
${p.full} ... PETITIONER
(By Sri. ${advocate(i, 1)}, Advocate)
AND:
State of Karnataka ... RESPONDENT
(By Smt. ${advocate(i, 2)}, High Court Government Pleader)`;
  const p2 = `The petition seeks regular bail. The complainant ${c.full} alleges that the petitioner ${p.first} threatened him. ${wf.full}, wife of the complainant, supports the allegation. The accused ${p.sur} is in custody since 2.1.2025.`;
  const p3 = `${advocate(i, 1)} argues that ${p.full} has no antecedents. The Complainant's wife ${wf.first} is not an eyewitness. Bail is granted to ${p.full} on conditions.`;
  return {
    id: `bail-${i}`,
    kind: 'bail petition',
    pages: [p1, p2, p3],
    persons: [p.full, c.full, wf.full, p.first, wf.first, p.sur],
    keep: [judge(i), advocate(i, 1), advocate(i, 2), 'State of Karnataka', '2.1.2025'],
    sensitive: null,
    victimIdentifiers: [],
  };
}

const SENSITIVE_TEMPLATES: Record<
  string,
  { category: SensitiveCategory; caseType: string; statute: string; extra: string }
> = {
  pocso: {
    category: 'pocso',
    caseType: 'CRIMINAL APPEAL',
    statute: 'Section 6 of the Protection of Children from Sexual Offences Act, 2012',
    extra: 'The minor girl',
  },
  sexual: {
    category: 'sexual_offence',
    caseType: 'CRIMINAL APPEAL',
    statute: 'Section 376 of the Indian Penal Code',
    extra: 'The prosecutrix',
  },
  juvenile: {
    category: 'juvenile',
    caseType: 'CRIMINAL REVISION PETITION',
    statute: 'Section 15 of the Juvenile Justice (Care and Protection of Children) Act, 2015',
    extra: 'The child in conflict with law',
  },
  matrimonial: {
    category: 'matrimonial',
    caseType: 'MATRIMONIAL APPEAL',
    statute: 'Section 13 of the Hindu Marriage Act, 1955',
    extra: 'The wife',
  },
  camera: {
    category: 'in_camera',
    caseType: 'CRIMINAL PETITION',
    statute: 'Section 327 of the Code of Criminal Procedure',
    extra: 'The proceedings were conducted in camera and the witness',
  },
  acquittal: {
    category: 'acquittal',
    caseType: 'CRIMINAL APPEAL',
    statute: 'Section 302 of the Indian Penal Code',
    extra: 'The trial court',
  },
};

function sensitive(i: number, key: string): LabelledJudgment {
  const t = SENSITIVE_TEMPLATES[key]!;
  const a = person(i, 1);
  const v = person(i, 2);
  const par = person(i, 3);
  const kind = t.category;
  const school = 'Sunrise Public School';
  const victimBlock =
    kind === 'pocso' || kind === 'sexual_offence' || kind === 'juvenile'
      ? `The victim ${v.full}, aged 14 years, a student of ${school}, was living with her father ${par.full}. The victim ${v.first} deposed that the accused ${a.full} followed her.`
      : kind === 'matrimonial'
        ? `The petitioner ${a.full} filed for divorce against his wife ${v.full}. The Respondent's father Sri. ${par.full} gave evidence. PW-1 ${v.first} deposed on cruelty.`
        : `The accused ${a.full} was tried. PW-1 ${v.full} and PW-2 ${par.full} were examined.`;
  const operative =
    kind === 'acquittal'
      ? `The accused ${a.sur} is acquitted of the charge under ${t.statute} and set at liberty.`
      : `Having heard ${advocate(i, 1)}, the appeal is decided under ${t.statute}.`;
  const p1 = `${header(i, t.caseType)}
BETWEEN:
${a.full} S/o ${par.full} ... ${kind === 'matrimonial' ? 'PETITIONER' : 'APPELLANT'}
(By Sri. ${advocate(i, 1)}, Advocate)
AND:
State of Karnataka ... RESPONDENT
(By Smt. ${advocate(i, 2)}, State Public Prosecutor)`;
  const p2 = `${t.extra} ${v.first} is identified only in the sealed cover. ${victimBlock} Born on 12.4.2010 (date of birth), residing at 22, Temple Street, Hubballi.`;
  const p3 = `${operative} ${v.sur} family is directed to receive compensation.`;
  return {
    id: `sensitive-${key}-${i}`,
    kind: `sensitive ${key}`,
    pages: [p1, p2, p3],
    persons: [a.full, v.full, par.full, a.first, v.first, v.sur, a.sur],
    keep: [judge(i), advocate(i, 1), advocate(i, 2), 'State of Karnataka', t.statute],
    sensitive: t.category,
    victimIdentifiers: [v.full, v.first, par.full, 'aged 14 years', school, '12.4.2010', '22, Temple Street'],
  };
}

/** The 40 labelled judgments of the evaluation. */
export function buildFixtures(): LabelledJudgment[] {
  const out: LabelledJudgment[] = [];
  for (let i = 0; i < 12; i += 1) out.push(criminalAppeal(i));
  for (let i = 0; i < 6; i += 1) out.push(civilSuit(i + 12));
  for (let i = 0; i < 6; i += 1) out.push(bailWithRelative(i + 18));
  const sens: [string, number][] = [
    ['pocso', 3],
    ['sexual', 3],
    ['juvenile', 3],
    ['matrimonial', 3],
    ['camera', 2],
    ['acquittal', 2],
  ];
  let n = 24;
  for (const [key, count] of sens) {
    for (let k = 0; k < count; k += 1) {
      out.push(sensitive(n, key));
      n += 1;
    }
  }
  return out;
}
