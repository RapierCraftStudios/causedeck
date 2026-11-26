import { describe, expect, it } from 'vitest';

import { detectSensitiveCategory } from './sensitive.ts';

const RECITALS = 'Heard the learned counsel for the parties and perused the record. '.repeat(20);

const header = (court: string, caseType: string, parties: string) => `IN THE ${court}
${caseType}
BETWEEN:
${parties}
JUDGMENT`;

describe('detectSensitiveCategory: matrimonial scope (#1188)', () => {
  it('does not mark a criminal appeal citing a divorce precedent as matrimonial', () => {
    const pages = [
      header(
        'SUPREME COURT OF INDIA',
        'CRIMINAL APPEAL NO. 1123 OF 2019 (under Section 302 of the Indian Penal Code)',
        'Mohan Lal ... APPELLANT\nAND:\nState of Rajasthan ... RESPONDENT',
      ),
      `${RECITALS} On the standard of appreciation of evidence, reliance is placed on Samar Ghosh v. Jaya Ghosh, a divorce case, where this Court observed that each case turns on its own facts.`,
      'The appeal is dismissed.',
    ];
    expect(detectSensitiveCategory('Mohan Lal v. State of Rajasthan', pages)).toBeNull();
  });

  it('does not mark a land-acquisition appeal mentioning the "matrimonial home" as matrimonial', () => {
    const pages = [
      header(
        'SUPREME COURT OF INDIA',
        'CIVIL APPEAL NO. 4410 OF 2021 (under the Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and Resettlement Act, 2013)',
        'Land Acquisition Collector ... APPELLANT\nAND:\nSmt. Kamla Devi ... RESPONDENT',
      ),
      `${RECITALS} The respondent stated that the acquired structure was her matrimonial home, built by her late husband, and claimed solatium for it.`,
      'The compensation is enhanced. The appeal is partly allowed.',
    ];
    expect(detectSensitiveCategory('Land Acquisition Collector v. Kamla Devi', pages)).toBeNull();
  });

  it('does not mark an SC/ST bail appeal mentioning section 498A as matrimonial', () => {
    const pages = [
      header(
        'HIGH COURT OF KARNATAKA',
        'CRIMINAL APPEAL NO. 210 OF 2022 (under Section 14A of the Scheduled Castes and the Scheduled Tribes (Prevention of Atrocities) Act, 1989, against refusal of bail)',
        'Rajesh ... APPELLANT\nAND:\nState of Karnataka ... RESPONDENT',
      ),
      `${RECITALS} The appellant has no antecedents except a complaint under section 498A of the Indian Penal Code filed by his sister-in-law, which was closed.`,
      'The appellant is enlarged on bail.',
    ];
    expect(detectSensitiveCategory('Rajesh v. State of Karnataka', pages)).toBeNull();
  });

  it('marks a Hindu Marriage Act appeal as matrimonial', () => {
    const pages = [
      header(
        'HIGH COURT OF KARNATAKA',
        'MISCELLANEOUS FIRST APPEAL NO. 77 OF 2020 (under Section 28 of the Hindu Marriage Act, 1955)',
        'X ... APPELLANT\nAND:\nY ... RESPONDENT',
      ),
      `${RECITALS} The appeal is dismissed.`,
    ];
    expect(detectSensitiveCategory('X v. Y', pages)).toBe('matrimonial');
  });

  it('marks a 498A quashing petition as matrimonial', () => {
    const pages = [
      header(
        'HIGH COURT OF KARNATAKA',
        'CRIMINAL PETITION NO. 5120 OF 2023 (under Section 482 Cr.P.C. to quash the proceedings for the offence punishable under section 498A of the Indian Penal Code)',
        'A ... PETITIONER\nAND:\nState of Karnataka ... RESPONDENT',
      ),
      `${RECITALS} The proceedings are quashed.`,
    ];
    expect(detectSensitiveCategory('A v. State of Karnataka', pages)).toBe('matrimonial');
  });

  it('reads matrimonial from the title alone', () => {
    expect(
      detectSensitiveCategory('In re: Petition for divorce, P v. Q', ['JUDGMENT', RECITALS]),
    ).toBe('matrimonial');
  });

  it('ignores a matrimonial word deep inside a long first page', () => {
    const page1 = `${header('SUPREME COURT OF INDIA', 'CIVIL APPEAL NO. 1 OF 2020', 'A ... APPELLANT\nAND:\nB ... RESPONDENT')}\n${RECITALS.repeat(5)} A divorce decree was cited.`;
    expect(page1.length).toBeGreaterThan(4000);
    expect(detectSensitiveCategory('A v. B', [page1])).toBeNull();
  });
});

describe('detectSensitiveCategory: protective categories keep whole-text scope', () => {
  const plainHead = header(
    'HIGH COURT OF KARNATAKA',
    'CRIMINAL APPEAL NO. 9 OF 2021',
    'A ... APPELLANT\nAND:\nState of Karnataka ... RESPONDENT',
  );

  it('detects POCSO mentioned only in the body', () => {
    const pages = [plainHead, RECITALS, 'The conviction under the POCSO Act is confirmed.'];
    expect(detectSensitiveCategory('A v. State', pages)).toBe('pocso');
  });

  it('detects a sexual offence mentioned only in the body', () => {
    const pages = [plainHead, RECITALS, 'The charge under section 376 of the IPC is proved.'];
    expect(detectSensitiveCategory('A v. State', pages)).toBe('sexual_offence');
  });

  it('detects the JJ Act mentioned only in the body', () => {
    const pages = [plainHead, RECITALS, 'The matter is remitted to the Juvenile Justice Board.'];
    expect(detectSensitiveCategory('A v. State', pages)).toBe('juvenile');
  });

  it('lets a protective category win over a matrimonial head', () => {
    const pages = [
      header('HIGH COURT', 'CRIMINAL PETITION (section 498A IPC)', 'A ... PETITIONER'),
      RECITALS,
      'The charge under section 376 of the IPC is framed.',
    ];
    expect(detectSensitiveCategory('A v. State', pages)).toBe('sexual_offence');
  });
});
