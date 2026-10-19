import { describe, expect, it } from 'vitest';

import { CATEGORIES } from '../../categories.ts';
import { getTranslator } from '../messages.ts';
import {
  isMandatoryTemplate,
  preferencesUrl,
  renderEmail,
  TEMPLATE_NAMES,
  TEMPLATES,
  type TemplateName,
  type TemplateProps,
} from '../render.ts';

const APP = 'https://app.causedeck.test';
const PREFS = preferencesUrl(APP);

const FIXTURES: { [K in TemplateName]: TemplateProps[K] } = {
  'magic-link': {
    url: `${APP}/api/auth/magic-link/verify?token=abc&callbackURL=%2F`,
    expiresInMinutes: 10,
  },
  invitation: { url: `${APP}/invite/tok123`, expiresInDays: 7, preferencesUrl: PREFS },
  'security-alert': {
    title: 'New sign-in from Chennai',
    body: 'A new device signed in to your account.',
    href: `${APP}/settings/security`,
  },
  'daily-digest': {
    items: [
      { title: 'Hearing tomorrow', href: `${APP}/w/iyer/matters/1` },
      { title: 'Order uploaded', href: `${APP}/w/iyer/matters/2` },
    ],
    appUrl: APP,
    preferencesUrl: PREFS,
  },
  'billing-notice': {
    title: 'Payment received',
    body: 'Your subscription renewed.',
    href: `${APP}/w/iyer/settings/billing`,
    preferencesUrl: PREFS,
  },
};

const LOCALES = ['en', 'ta', 'kn'] as const;

describe.each(TEMPLATE_NAMES)('template %s', (name) => {
  it.each(LOCALES)('renders valid HTML and plain text in %s', async (locale) => {
    const email = await renderEmail(name, FIXTURES[name] as never, locale);
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.html).toMatch(/^<!DOCTYPE html/);
    expect(email.html).toMatch(new RegExp(`<html[^>]*\\blang="${locale}"`));
    expect(email.html.trimEnd()).toMatch(/<\/html>$/);
    expect(email.text.trim().length).toBeGreaterThan(0);
    // Every string resolved: no raw key ids or ICU placeholders left over.
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toContain('notifications.email');
      expect(part).not.toMatch(/\{(minutes|days|count|title)\b/);
    }
  });

  it('contains no remote images or tracking pixels', async () => {
    for (const locale of LOCALES) {
      const { html } = await renderEmail(name, FIXTURES[name] as never, locale);
      expect(html).not.toMatch(/<img\b/i);
      expect(html).not.toMatch(/\bsrc\s*=/i);
      expect(html).not.toMatch(/url\(/i);
      expect(html).not.toMatch(/background\s*=\s*["']https?:/i);
    }
  });

  it('links to notification preferences only for non-mandatory categories', async () => {
    const { category } = TEMPLATES[name];
    const mandatory = category === null || CATEGORIES[category].mandatory;
    expect(isMandatoryTemplate(name)).toBe(mandatory);
    const { html, text } = await renderEmail(name, FIXTURES[name] as never, 'en');
    if (mandatory) {
      expect(html).not.toContain('data-preferences-link');
      expect(html).not.toContain(PREFS);
    } else {
      expect(html).toContain(`href="${PREFS}"`);
      expect(text).toContain(PREFS);
    }
  });

  it('matches the English snapshot', async () => {
    const email = await renderEmail(name, FIXTURES[name] as never, 'en');
    expect(email.subject).toMatchSnapshot('subject');
    expect(email.text).toMatchSnapshot('text');
    expect(email.html).toMatchSnapshot('html');
  });
});

describe('category mapping', () => {
  it('security alerts are mandatory and billing, digest and invitation are not', () => {
    expect(isMandatoryTemplate('security-alert')).toBe(true);
    expect(isMandatoryTemplate('magic-link')).toBe(true);
    expect(isMandatoryTemplate('invitation')).toBe(false);
    expect(isMandatoryTemplate('daily-digest')).toBe(false);
    expect(isMandatoryTemplate('billing-notice')).toBe(false);
  });
});

describe('links in the plain-text part', () => {
  it('puts the magic link on its own line with nothing glued to it', async () => {
    const { url } = FIXTURES['magic-link'];
    const { text } = await renderEmail('magic-link', FIXTURES['magic-link'], 'en');
    expect(text.split('\n').map((line) => line.trim())).toContain(url);
    const match = /https:\/\/app\.causedeck\.test\/api\/auth\/magic-link\/verify\S*/.exec(text);
    expect(match?.[0]).toBe(url);
  });
});

describe('i18n', () => {
  it('resolves every email key in en, ta and kn with plural arguments', async () => {
    for (const locale of LOCALES) {
      const t = await getTranslator(locale);
      expect(t('invitation.body', { days: 1 })).not.toContain('{');
      expect(t('dailyDigest.summary', { count: 3 })).toContain('3');
    }
    const en = await getTranslator('en');
    expect(en('invitation.body', { days: 7 })).toContain('7 days');
    expect(en('dailyDigest.summary', { count: 1 })).toContain('1 update ');
  });

  it('renders Tamil and Kannada copy, not English', async () => {
    const ta = await renderEmail('magic-link', FIXTURES['magic-link'], 'ta');
    const kn = await renderEmail('magic-link', FIXTURES['magic-link'], 'kn');
    expect(ta.text).toMatch(/[஀-௿]/);
    expect(kn.text).toMatch(/[ಀ-೿]/);
  });

  it('throws on an unknown key', async () => {
    const t = await getTranslator('en');
    expect(() => t('nope.missing')).toThrow(/Missing email message/);
  });
});
