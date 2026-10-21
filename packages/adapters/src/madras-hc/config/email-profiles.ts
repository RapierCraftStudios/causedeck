// AIMS cause-list email profiles (#395): the court's pilot email push to advocates who tag their
// cases (Notification 230/2026, research/raw/08 §2). The parser (#396) picks the first profile whose
// subject matches, so a new template is config only. No sample email was read yet: the profile below
// is a placeholder until fixtures land.

export const EMAIL_LAYOUTS = ['table', 'lines', 'pdf_only'] as const;
export type EmailLayout = (typeof EMAIL_LAYOUTS)[number];

export interface AimsEmailProfile {
  id: string;
  /** Regex source matched case-insensitively against the subject. */
  subject: string;
  layout: EmailLayout;
}

export const AIMS_EMAIL_PROFILES: readonly AimsEmailProfile[] = [
  { id: 'aims-push-v1', subject: '\\bcause\\s*list\\b', layout: 'lines' },
];
