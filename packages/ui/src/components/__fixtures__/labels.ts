// Story and test copy. Names are fictional (no real parties, advocates or case numbers).

export const MATTER_TITLE = 'M/s Kaveri Textiles v. State of Tamil Nadu';

export const LONG_LABEL = `File vakalatnama and index of documents for ${MATTER_TITLE}`;

/** Fictional people for avatars and assignee lists. */
export const PEOPLE = {
  advocate: 'Meenakshi Raghavan',
  junior: 'Arun Gowda',
  clerk: 'Farhan Siddiqui',
  long: 'Venkata Lakshmi Narasimha Subramanya Sastry',
} as const;

/** Matters for lists, cards and toasts. */
export const MATTERS = [
  MATTER_TITLE,
  'Nilgiri Tea Estates Ltd. v. Coonoor Municipality',
  'R. Selvaraj v. Tamil Nadu Housing Board',
  'Hampi Silk Weavers Society v. Union of India',
  'In re: Estate of late K. Padmanabhan',
  'Malnad Coffee Growers v. Karnataka Forest Department',
  'S. Dhanalakshmi v. Commissioner of Income Tax',
  'Cauvery Logistics Pvt. Ltd. v. Bharat Freight Ltd.',
] as const;

/** Tamil and Kannada strings exercise the Noto Indic faces and their taller line boxes. */
export const INDIC = {
  ta: {
    save: 'சேமி',
    upload: 'வழக்கு ஆவணங்களைப் பதிவேற்றவும்',
    loading: 'ஏற்றுகிறது',
    then: 'பின்',
    person: 'மீனாட்சி ராகவன்',
    hearing: 'அடுத்த விசாரணை',
    filed: 'தாக்கல் செய்யப்பட்டது',
    noMatters: 'வழக்குகள் இல்லை',
    noMattersBody: 'முதல் வழக்கைச் சேர்த்துத் தொடங்குங்கள்.',
    addMatter: 'வழக்கைச் சேர்',
    saved: 'வரைவு சேமிக்கப்பட்டது',
    undo: 'செயல்தவிர்',
    close: 'மூடு',
    offline: 'நீங்கள் ஆஃப்லைனில் உள்ளீர்கள்.',
    resize: 'அளவை மாற்று',
  },
  kn: {
    save: 'ಉಳಿಸಿ',
    upload: 'ಪ್ರಕರಣದ ದಾಖಲೆಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ',
    loading: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ',
    then: 'ನಂತರ',
    person: 'ಅರುಣ್ ಗೌಡ',
    hearing: 'ಮುಂದಿನ ವಿಚಾರಣೆ',
    filed: 'ಸಲ್ಲಿಸಲಾಗಿದೆ',
    noMatters: 'ಪ್ರಕರಣಗಳಿಲ್ಲ',
    noMattersBody: 'ಮೊದಲ ಪ್ರಕರಣವನ್ನು ಸೇರಿಸಿ ಪ್ರಾರಂಭಿಸಿ.',
    addMatter: 'ಪ್ರಕರಣ ಸೇರಿಸಿ',
    saved: 'ಕರಡು ಉಳಿಸಲಾಗಿದೆ',
    undo: 'ರದ್ದುಮಾಡಿ',
    close: 'ಮುಚ್ಚಿ',
    offline: 'ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ.',
    resize: 'ಗಾತ್ರ ಬದಲಿಸಿ',
  },
} as const;
