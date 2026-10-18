// Story and test copy. Names are fictional (no real parties, advocates or case numbers).

export const MATTER_TITLE = 'M/s Kaveri Textiles v. State of Tamil Nadu';

export const LONG_LABEL = `File vakalatnama and index of documents for ${MATTER_TITLE}`;

/** Tamil and Kannada strings exercise the Noto Indic faces and their taller line boxes. */
export const INDIC = {
  ta: {
    save: 'சேமி',
    upload: 'வழக்கு ஆவணங்களைப் பதிவேற்றவும்',
    loading: 'ஏற்றுகிறது',
    then: 'பின்',
  },
  kn: {
    save: 'ಉಳಿಸಿ',
    upload: 'ಪ್ರಕರಣದ ದಾಖಲೆಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ',
    loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ',
    then: 'ನಂತರ',
  },
} as const;

/** Form copy: field labels, hints, errors and option lists (fictional courts and matters). */
export const FORM = {
  matter: {
    label: 'Matter title',
    hint: 'As it appears on the cause list.',
    error: 'Enter the matter title.',
    value: MATTER_TITLE,
  },
  notes: {
    label: 'Hearing notes',
    hint: 'Visible only to your chamber.',
    error: 'Notes must be under 2,000 characters.',
    value: 'Counsel for the respondent sought time to file a counter affidavit.',
  },
  court: {
    label: 'Court',
    hint: 'Where the matter is listed.',
    error: 'Choose a court.',
    placeholder: 'Choose a court',
  },
  urgent: { label: 'Mark as urgent', hint: 'Shown first on the court-day board.' },
  remind: { label: 'Remind me the evening before', hint: 'A notification at 7 pm IST.' },
  stage: { label: 'Stage', hint: 'Current stage of the proceeding.', error: 'Choose a stage.' },
  days: { label: 'Reminder lead time (days)', hint: 'How many days before the hearing.' },
  view: { label: 'Board view' },
} as const;

export const COURTS = [
  { value: 'mhc-chennai', label: 'Madras High Court, Principal Seat' },
  { value: 'mhc-madurai', label: 'Madras High Court, Madurai Bench' },
  { value: 'khc-bengaluru', label: 'Karnataka High Court, Bengaluru' },
  { value: 'khc-dharwad', label: 'Karnataka High Court, Dharwad Bench' },
  { value: 'city-civil-chennai', label: 'City Civil Court, Chennai', disabled: true },
  { value: 'cmm-egmore', label: 'Chief Metropolitan Magistrate, Egmore' },
] as const;

export const STAGES = [
  { value: 'filed', label: 'Filed' },
  { value: 'numbered', label: 'Numbered' },
  { value: 'listed', label: 'Listed' },
  { value: 'reserved', label: 'Reserved' },
] as const;

/** Tamil and Kannada form copy for the label-variant stories. */
export const INDIC_FORM = {
  ta: {
    matter: 'வழக்கின் தலைப்பு',
    hint: 'வழக்குப் பட்டியலில் உள்ளபடி.',
    error: 'வழக்கின் தலைப்பை உள்ளிடவும்.',
    court: 'நீதிமன்றம்',
    choose: 'நீதிமன்றத்தைத் தேர்ந்தெடுக்கவும்',
    urgent: 'அவசரம் எனக் குறிக்கவும்',
    empty: 'பொருத்தம் இல்லை',
  },
  kn: {
    matter: 'ಪ್ರಕರಣದ ಶೀರ್ಷಿಕೆ',
    hint: 'ಕಾಸ್ ಲಿಸ್ಟ್‌ನಲ್ಲಿರುವಂತೆ.',
    error: 'ಪ್ರಕರಣದ ಶೀರ್ಷಿಕೆಯನ್ನು ನಮೂದಿಸಿ.',
    court: 'ನ್ಯಾಯಾಲಯ',
    choose: 'ನ್ಯಾಯಾಲಯವನ್ನು ಆಯ್ಕೆಮಾಡಿ',
    urgent: 'ತುರ್ತು ಎಂದು ಗುರುತಿಸಿ',
    empty: 'ಹೊಂದಾಣಿಕೆ ಇಲ್ಲ',
  },
} as const;
