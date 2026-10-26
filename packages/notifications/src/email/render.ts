// Renders an email template to subject, HTML and plain text in the recipient's locale. Templates are
// explicit calls: auth emails (magic link, invitation) name their template; member notifications
// reach here through the delivery job (#196). Every string comes from an i18n key.
import { render } from '@react-email/components';
import type { ReactElement } from 'react';

import { CATEGORIES, type CategoryKey } from '../categories.ts';
import { getTranslator, toEmailLocale, type EmailLocale, type Translate } from './messages.ts';
import {
  BillingNoticeEmail,
  billingNoticeSubject,
  type BillingNoticeProps,
} from './templates/billing-notice.tsx';
import {
  DailyDigestEmail,
  dailyDigestSubject,
  type DailyDigestProps,
} from './templates/daily-digest.tsx';
import {
  EndOfDayDigestEmail,
  endOfDayDigestSubject,
  type EndOfDayDigestProps,
} from './templates/end-of-day-digest.tsx';
import {
  EveningBriefEmail,
  eveningBriefSubject,
  type EveningBriefProps,
} from './templates/evening-brief.tsx';
import {
  MorningDiffEmail,
  morningDiffSubject,
  type MorningDiffProps,
} from './templates/morning-diff.tsx';
import {
  OutcomeMissingEmail,
  outcomeMissingSubject,
  type OutcomeMissingProps,
} from './templates/outcome-missing.tsx';
import {
  NewsDigestEmail,
  newsDigestSubject,
  type NewsDigestProps,
} from './templates/news-digest.tsx';
import {
  InvitationEmail,
  invitationSubject,
  type InvitationProps,
} from './templates/invitation.tsx';
import { MagicLinkEmail, magicLinkSubject, type MagicLinkProps } from './templates/magic-link.tsx';
import { NoticeEmail, noticeSubject, type NoticeProps } from './templates/notice.tsx';
import {
  SecurityAlertEmail,
  securityAlertSubject,
  type SecurityAlertProps,
} from './templates/security-alert.tsx';

export interface TemplateProps {
  'magic-link': MagicLinkProps;
  invitation: InvitationProps;
  'security-alert': SecurityAlertProps;
  'daily-digest': DailyDigestProps;
  'end-of-day-digest': EndOfDayDigestProps;
  'news-digest': NewsDigestProps;
  'evening-brief': EveningBriefProps;
  'morning-diff': MorningDiffProps;
  'outcome-missing': OutcomeMissingProps;
  'billing-notice': BillingNoticeProps;
  notice: NoticeProps;
}

export type TemplateName = keyof TemplateProps;

interface TemplateDefinition<P> {
  /** The notification category, or `null` for auth email outside the registry (magic link). */
  category: CategoryKey | null;
  subject: (t: Translate, props: P) => string;
  component: (props: P & { t: Translate; lang: string }) => ReactElement;
}

export const TEMPLATES: { [K in TemplateName]: TemplateDefinition<TemplateProps[K]> } = {
  'magic-link': { category: null, subject: magicLinkSubject, component: MagicLinkEmail },
  invitation: {
    category: 'workspace.invite',
    subject: invitationSubject,
    component: InvitationEmail,
  },
  'security-alert': {
    category: 'security.alert',
    subject: securityAlertSubject,
    component: SecurityAlertEmail,
  },
  'daily-digest': {
    category: 'digest.daily',
    subject: dailyDigestSubject,
    component: DailyDigestEmail,
  },
  'end-of-day-digest': {
    category: 'digest.end_of_day',
    subject: endOfDayDigestSubject,
    component: EndOfDayDigestEmail,
  },
  'news-digest': {
    category: 'digest.news',
    subject: newsDigestSubject,
    component: NewsDigestEmail,
  },
  'evening-brief': {
    category: 'reminder.evening',
    subject: eveningBriefSubject,
    component: EveningBriefEmail,
  },
  'morning-diff': {
    category: 'reminder.morning',
    subject: morningDiffSubject,
    component: MorningDiffEmail,
  },
  'outcome-missing': {
    category: 'reminder.outcome_missing',
    subject: outcomeMissingSubject,
    component: OutcomeMissingEmail,
  },
  'billing-notice': {
    category: 'billing.notice',
    subject: billingNoticeSubject,
    component: BillingNoticeEmail,
  },
  notice: { category: 'system.notice', subject: noticeSubject, component: NoticeEmail },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES) as TemplateName[];

/** Auth email (no category) and mandatory categories carry no unsubscribe-preferences link. */
export function isMandatoryTemplate(template: TemplateName): boolean {
  const { category } = TEMPLATES[template];
  return category === null || CATEGORIES[category].mandatory;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderEmail<K extends TemplateName>(
  template: K,
  props: TemplateProps[K],
  locale: EmailLocale = 'en',
): Promise<RenderedEmail> {
  const lang = toEmailLocale(locale);
  const t = await getTranslator(lang);
  const definition = TEMPLATES[template] as TemplateDefinition<TemplateProps[K]>;
  // Templates are hook-free functions, so calling one directly yields the element tree to render.
  const element = definition.component({ ...props, t, lang });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: definition.subject(t, props), html, text };
}

/** Where the footer link points: the member's notification preferences (#199). */
export function preferencesUrl(appUrl: string | URL): string {
  return new URL('/settings/notifications', appUrl).toString();
}
