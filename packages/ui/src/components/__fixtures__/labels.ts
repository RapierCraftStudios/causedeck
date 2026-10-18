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
