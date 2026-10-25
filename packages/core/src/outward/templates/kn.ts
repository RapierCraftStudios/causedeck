// Kannada fact blocks (#735), per audience and tone; an unconfirmed fact says so.
import type { Audience, Tone } from '@causedeck/validators/outward-draft';

import { dateParts, type FactTemplate } from './en.ts';

const MONTHS = [
  'ಜನವರಿ',
  'ಫೆಬ್ರವರಿ',
  'ಮಾರ್ಚ್',
  'ಏಪ್ರಿಲ್',
  'ಮೇ',
  'ಜೂನ್',
  'ಜುಲೈ',
  'ಆಗಸ್ಟ್',
  'ಸೆಪ್ಟೆಂಬರ್',
  'ಅಕ್ಟೋಬರ್',
  'ನವೆಂಬರ್',
  'ಡಿಸೆಂಬರ್',
];

const tbc = (confirmed: boolean) => (confirmed ? '' : ' (ದೃಢೀಕರಿಸಬೇಕು)');

const OPENING: Record<Audience, Record<Tone, string>> = {
  client: {
    formal: 'ಪ್ರಿಯ ಮಹೋದಯರೇ, ನಿಮ್ಮ ಪ್ರಕರಣದ ಸ್ಥಿತಿಯ ಕುರಿತ ಮಾಹಿತಿ ಇದು.',
    brief: 'ನಿಮ್ಮ ಪ್ರಕರಣದ ಮಾಹಿತಿ:',
    warm: 'ನಮಸ್ಕಾರ, ನಿಮ್ಮ ಪ್ರಕರಣದ ಪ್ರಸ್ತುತ ಸ್ಥಿತಿ ಇದು.',
  },
  senior_counsel: {
    formal: 'ಗೌರವಾನ್ವಿತರೇ, ಪ್ರಕರಣದ ಸ್ಥಿತಿಯ ಕುರಿತ ಮಾಹಿತಿ ಇದು.',
    brief: 'ಮಾಹಿತಿ:',
    warm: 'ನಮಸ್ಕಾರ, ಪ್ರಕರಣದ ಕುರಿತು ಚಿಕ್ಕ ಮಾಹಿತಿ.',
  },
  briefing_counsel: {
    formal: 'ಗೌರವಾನ್ವಿತರೇ, ನಿಮ್ಮ ಬ್ರೀಫಿಂಗ್‌ಗಾಗಿ ಮಾಹಿತಿ ಇದು.',
    brief: 'ಬ್ರೀಫಿಂಗ್ ಮಾಹಿತಿ:',
    warm: 'ನಮಸ್ಕಾರ, ನಿಮ್ಮ ಬ್ರೀಫಿಂಗ್‌ಗಾಗಿ ಚಿಕ್ಕ ಮಾಹಿತಿ.',
  },
};

const CLOSING: Record<Tone, string> = {
  formal: 'ಹೆಚ್ಚಿನ ವಿವರ ಬೇಕಿದ್ದರೆ ತಿಳಿಸಿ.',
  brief: '',
  warm: 'ಏನಾದರೂ ಅಸ್ಪಷ್ಟವಾಗಿದ್ದರೆ ಸಂಪರ್ಕಿಸಿ.',
};

export const kn: FactTemplate = {
  opening: (audience, tone) => OPENING[audience][tone],
  closing: (_audience, tone) => CLOSING[tone],
  date(iso) {
    const { day, month, year } = dateParts(iso);
    return `${day} ${MONTHS[month] ?? ''} ${year}`;
  },
  nextDate(iso, confirmed) {
    return `ಮುಂದಿನ ದಿನಾಂಕ ${this.date(iso)}${tbc(confirmed)}.`;
  },
  outcome: (text, confirmed) => `ಫಲಿತಾಂಶ: ${text.replace(/[.\s]+$/u, '')}${tbc(confirmed)}.`,
  order(orderType, iso, confirmed) {
    return `${this.date(iso)} ರಂದು ${orderType} ಆದೇಶ ಹೊರಡಿಸಲಾಯಿತು${tbc(confirmed)}.`;
  },
  obligation(description, dueIso, confirmed) {
    const due = dueIso === null ? '' : `, ಕೊನೆಯ ದಿನಾಂಕ ${this.date(dueIso)}`;
    return `ಬಾಕಿ ಇರುವುದು: ${description.replace(/[.\s]+$/u, '')}${due}${tbc(confirmed)}.`;
  },
};
