// Overlay and navigation copy for stories and tests. Names are fictional.
import { MATTER_TITLE } from './labels';

export { MATTER_TITLE };

export const OTHER_MATTER = 'Smt. Lakshmi Narayanan v. Coimbatore Municipal Corporation';

export const LONG_DESCRIPTION =
  `The hearing in ${MATTER_TITLE} moves to the next listed date. Linked tasks, obligations ` +
  'and reminders follow the new date, and the client is told once you confirm.';

/** Matter actions used by menus, the command palette and context menus. */
export const MATTER_ACTIONS = [
  { id: 'open', label: 'Open matter', shortcut: 'mod+o' },
  { id: 'hearing', label: 'Add hearing', shortcut: 'h' },
  { id: 'note', label: 'Add note', shortcut: 'n' },
  { id: 'archive', label: 'Archive matter' },
] as const;

export const BREADCRUMB_TRAIL = ['Matters', 'Madras High Court', MATTER_TITLE] as const;

export const SHORTCUTS = [
  { keys: 'mod+k', description: 'Open the command palette', group: 'General' },
  { keys: '?', description: 'Show keyboard shortcuts', group: 'General' },
  { keys: 'g then t', description: 'Go to today', group: 'Navigation' },
  { keys: 'g then m', description: 'Go to matters', group: 'Navigation' },
  { keys: 'n', description: 'Add note', group: 'Matter' },
] as const;

/** Tamil and Kannada overlay copy (taller line boxes, longer words). */
export const OVERLAY_INDIC = {
  ta: {
    title: 'விசாரணையை மாற்றவும்',
    description: 'அடுத்த விசாரணை தேதியை உறுதிசெய்யவும்.',
    open: 'திற',
    close: 'மூடு',
    cancel: 'ரத்துசெய்',
    confirm: 'உறுதிசெய்',
    actions: ['வழக்கைத் திற', 'விசாரணையைச் சேர்', 'குறிப்பைச் சேர்'],
    tabs: ['விசாரணைகள்', 'ஆவணங்கள்', 'பணிகள்'],
    matters: 'வழக்குகள்',
    previous: 'முந்தைய',
    next: 'அடுத்து',
    search: 'தேடு',
    empty: 'முடிவுகள் இல்லை',
    shortcuts: 'விசைப்பலகை குறுக்குவழிகள்',
  },
  kn: {
    title: 'ವಿಚಾರಣೆಯನ್ನು ಮುಂದೂಡಿ',
    description: 'ಮುಂದಿನ ವಿಚಾರಣೆಯ ದಿನಾಂಕವನ್ನು ದೃಢೀಕರಿಸಿ.',
    open: 'ತೆರೆಯಿರಿ',
    close: 'ಮುಚ್ಚಿ',
    cancel: 'ರದ್ದುಮಾಡಿ',
    confirm: 'ದೃಢೀಕರಿಸಿ',
    actions: ['ಪ್ರಕರಣ ತೆರೆಯಿರಿ', 'ವಿಚಾರಣೆ ಸೇರಿಸಿ', 'ಟಿಪ್ಪಣಿ ಸೇರಿಸಿ'],
    tabs: ['ವಿಚಾರಣೆಗಳು', 'ದಾಖಲೆಗಳು', 'ಕಾರ್ಯಗಳು'],
    matters: 'ಪ್ರಕರಣಗಳು',
    previous: 'ಹಿಂದಿನ',
    next: 'ಮುಂದಿನ',
    search: 'ಹುಡುಕಿ',
    empty: 'ಫಲಿತಾಂಶಗಳಿಲ್ಲ',
    shortcuts: 'ಕೀಬೋರ್ಡ್ ಶಾರ್ಟ್‌ಕಟ್‌ಗಳು',
  },
} as const;
