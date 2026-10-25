// Tamil fact blocks (#735), per audience and tone; an unconfirmed fact says so.
import type { Audience, Tone } from '@causedeck/validators/outward-draft';

import { dateParts, type FactTemplate } from './en.ts';

const MONTHS = [
  'ஜனவரி',
  'பிப்ரவரி',
  'மார்ச்',
  'ஏப்ரல்',
  'மே',
  'ஜூன்',
  'ஜூலை',
  'ஆகஸ்ட்',
  'செப்டம்பர்',
  'அக்டோபர்',
  'நவம்பர்',
  'டிசம்பர்',
];

const tbc = (confirmed: boolean) => (confirmed ? '' : ' (உறுதிப்படுத்தப்பட வேண்டும்)');

const OPENING: Record<Audience, Record<Tone, string>> = {
  client: {
    formal: 'அன்பார்ந்த ஐயா/அம்மா, உங்கள் வழக்கின் நிலை குறித்த தகவல் இது.',
    brief: 'உங்கள் வழக்கு குறித்த தகவல்:',
    warm: 'வணக்கம், உங்கள் வழக்கின் தற்போதைய நிலை இது.',
  },
  senior_counsel: {
    formal: 'மதிப்பிற்குரிய ஐயா/அம்மா, வழக்கின் நிலை குறித்த தகவல் இது.',
    brief: 'தகவல்:',
    warm: 'வணக்கம், வழக்கு குறித்த சிறிய தகவல்.',
  },
  briefing_counsel: {
    formal: 'மதிப்பிற்குரிய ஐயா/அம்மா, உங்கள் விளக்கத்திற்கான தகவல் இது.',
    brief: 'விளக்கத் தகவல்:',
    warm: 'வணக்கம், உங்கள் விளக்கத்திற்கான சிறிய தகவல்.',
  },
};

const CLOSING: Record<Tone, string> = {
  formal: 'மேலும் விவரம் தேவைப்பட்டால் தெரிவிக்கவும்.',
  brief: '',
  warm: 'ஏதேனும் தெளிவில்லை என்றால் தொடர்பு கொள்ளுங்கள்.',
};

export const ta: FactTemplate = {
  opening: (audience, tone) => OPENING[audience][tone],
  closing: (_audience, tone) => CLOSING[tone],
  date(iso) {
    const { day, month, year } = dateParts(iso);
    return `${String(day)} ${MONTHS[month] ?? ''} ${String(year)}`;
  },
  nextDate(iso, confirmed) {
    return `அடுத்த தேதி ${this.date(iso)}${tbc(confirmed)}.`;
  },
  outcome: (text, confirmed) => `முடிவு: ${text.replace(/[.\s]+$/u, '')}${tbc(confirmed)}.`,
  order(orderType, iso, confirmed) {
    return `${this.date(iso)} அன்று ${orderType} உத்தரவு பிறப்பிக்கப்பட்டது${tbc(confirmed)}.`;
  },
  obligation(description, dueIso, confirmed) {
    const due = dueIso === null ? '' : `, கடைசி தேதி ${this.date(dueIso)}`;
    return `நிலுவையில்: ${description.replace(/[.\s]+$/u, '')}${due}${tbc(confirmed)}.`;
  },
};
