// Auth email strings are i18n keys, never prose: the transport (console now, React Email in #23)
// resolves them against the en/ta/kn catalogs for the recipient's locale.
export const AUTH_EMAIL_KEYS = {
  magicLink: {
    subject: 'auth.email.magicLink.subject',
    body: 'auth.email.magicLink.body',
  },
} as const;

export const AUTH_LOCALES = ['en', 'ta', 'kn'] as const;
export type AuthLocale = (typeof AUTH_LOCALES)[number];

export function toAuthLocale(value: unknown): AuthLocale {
  return (AUTH_LOCALES as readonly unknown[]).includes(value) ? (value as AuthLocale) : 'en';
}
