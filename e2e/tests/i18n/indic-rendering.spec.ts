// Indic rendering (#176, part of #24): Tamil and Kannada on a specimen, the sign-in page and the
// shell, in every viewport × theme project. Screenshot baselines only come from the e2e workflow's
// `update_snapshots` dispatch, so the checks that matter run on computed styles and layout:
//   - every Tamil/Kannada string is shaped by the shipped Noto face, never a system font or a
//     .notdef box (no tofu), read from Chromium's platform-font report;
//   - body text has line-height >= 1.7, no letter-spacing and no uppercase;
//   - no text is clipped or ellipsis-truncated, and a long button label wraps at 360 px;
//   - numerals stay in the Latin face (Geist) with tabular figures;
//   - the Indic faces are size-adjusted to the Latin x-height (apps/web/app/fonts.ts).
// The members page (#25) gets the same checks once it exists.
import { existsSync } from 'node:fs';

import type { Page, TestInfo } from '@playwright/test';
import postgres from 'postgres';

import { e2eUser, expect, test } from '../../fixtures/index.ts';
import { databaseUrl } from '../../support/db-reset.ts';
import { openShell } from '../shell/helpers.ts';

type IndicLocale = 'ta' | 'kn';

const INDIC: readonly IndicLocale[] = ['ta', 'kn'];

/** next/font family names of the Indic faces (apps/web/app/fonts.ts). */
const FAMILY = { ta: 'notoTamil', kn: 'notoKannada' } as const;

/** Specimen copy: conjuncts, vowel signs and glossary terms (packages/i18n/glossary.json). */
const SPECIMEN = {
  ta: {
    heading: 'வழக்குப் பட்டியல்',
    body: 'அடுத்த தேதி: கூட்டம், க்ஷேத்திரம், ஸ்ரீ, ஜன்னல், பொருள்கள். அமர்வு முன் பட்டியலிடப்பட்ட வழக்குகளின் உத்தரவுகள் இங்கே காட்டப்படும்.',
    prose:
      'நீதிமன்ற அறையில் அமர்வு கூடியதும், பட்டியலிடப்பட்ட வழக்குகள் வரிசையாக அழைக்கப்படும்; ஒவ்வொரு உத்தரவும் அடுத்த தேதியுடன் பதிவு செய்யப்படும்.',
    small: 'கூடுதல் விவரங்கள் கீழே உள்ளன',
    button: 'வழக்குப் பட்டியலில் அடுத்த தேதிக்கான உத்தரவைப் பதிவிறக்கு',
  },
  kn: {
    heading: 'ಕಾಸ್ ಲಿಸ್ಟ್',
    body: 'ಮುಂದಿನ ದಿನಾಂಕ: ಕ್ಷೇತ್ರ, ಶ್ರೀ, ಸ್ತ್ರೀ, ಪ್ರಕರಣ, ಆದೇಶ. ಪೀಠದ ಮುಂದೆ ಪಟ್ಟಿಯಾದ ಪ್ರಕರಣಗಳ ಆದೇಶಗಳನ್ನು ಇಲ್ಲಿ ತೋರಿಸಲಾಗುತ್ತದೆ.',
    prose:
      'ನ್ಯಾಯಾಲಯದ ಸಭಾಂಗಣದಲ್ಲಿ ಪೀಠ ಸೇರಿದ ನಂತರ ಪಟ್ಟಿಯಾದ ಪ್ರಕರಣಗಳನ್ನು ಕ್ರಮವಾಗಿ ಕರೆಯಲಾಗುತ್ತದೆ; ಪ್ರತಿಯೊಂದು ಆದೇಶವನ್ನು ಮುಂದಿನ ದಿನಾಂಕದೊಂದಿಗೆ ದಾಖಲಿಸಲಾಗುತ್ತದೆ.',
    small: 'ಹೆಚ್ಚಿನ ವಿವರಗಳು ಕೆಳಗಿವೆ',
    button: 'ಕಾಸ್ ಲಿಸ್ಟ್‌ನಲ್ಲಿರುವ ಮುಂದಿನ ದಿನಾಂಕದ ಆದೇಶವನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ',
  },
} as const;

function skipWithoutBaseline(testInfo: TestInfo, name: string) {
  const baseline = testInfo.snapshotPath(name, { kind: 'screenshot' });
  test.skip(
    testInfo.config.updateSnapshots === 'none' && !existsSync(baseline),
    'no baseline yet: dispatch the e2e workflow with update_snapshots',
  );
}

/** Signed out: the `NEXT_LOCALE` cookie picks the locale. */
async function openSignIn(page: Page, locale: IndicLocale): Promise<void> {
  await page.goto('/sign-in');
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: locale, url: page.url() }]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

/** Signed in, `user.locale` outranks the cookie (#175), so save it on the seeded owner. */
async function setOwnerLocale(database: string, locale: IndicLocale): Promise<void> {
  const sql = postgres(databaseUrl(database, 'superuser'), { max: 1, onnotice: () => undefined });
  try {
    await sql`update "user" set locale = ${locale} where email = ${e2eUser('owner').email}`;
  } finally {
    await sql.end();
  }
}

/** Waits for the Indic face itself, not just `document.fonts.ready` (it loads on first use). */
async function indicFontReady(page: Page, locale: IndicLocale): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async (family) => {
        await document.fonts.ready;
        return [...document.fonts].some(
          (face) => face.family.replaceAll(/['"]/g, '') === family && face.status === 'loaded',
        );
      }, FAMILY[locale]),
    )
    .toBe(true);
}

/** Prepends a lang-tagged specimen to the page, so it renders with the app's CSS and fonts. */
async function injectSpecimen(page: Page, locale: IndicLocale): Promise<void> {
  await page.evaluate(
    ({ copy, locale: lang }) => {
      // The sign-in submit button is a @causedeck/ui Button: clone it to keep its real classes.
      const source = document.querySelector('form button[type="submit"]');
      if (!source) throw new Error('specimen: no Button to clone');
      const section = document.createElement('section');
      section.dataset.specimen = lang;
      section.lang = lang;
      section.style.cssText =
        'padding:16px;max-width:100%;box-sizing:border-box;background:var(--surface)';
      section.innerHTML = `
        <h2 class="heading text-xl font-serif">${copy.heading}</h2>
        <p class="text-base">${copy.body}</p>
        <p class="prose">${copy.prose}</p>
        <div class="text-sm">${copy.small}</div>
        <span class="text-xs">${copy.small}</span>
        <p class="text-sm"><time class="num">12 Mar 2026</time> · <span data-inr>₹12,34,567.89</span> · <span class="num">WP 1234/2026</span></p>
        <div data-specimen-buttons></div>`;
      const button = source.cloneNode(true) as HTMLButtonElement;
      button.type = 'button';
      button.removeAttribute('disabled');
      button.textContent = copy.button;
      button.dataset.specimenButton = '';
      section.querySelector('[data-specimen-buttons]')?.append(button);
      document.body.prepend(section);
    },
    { copy: SPECIMEN[locale], locale },
  );
}

interface Finding {
  kind: string;
  text: string;
  detail: string;
}

/**
 * Every visible element that holds Tamil/Kannada text directly, checked in the page. Returns what
 * is wrong; an empty list passes. `scope` limits the audit to a subtree (default: the body).
 */
function audit(page: Page, locale: IndicLocale, scope = 'body'): Promise<Finding[]> {
  return page.evaluate(
    ({ lang, family, scope: selector }) => {
      const script = lang === 'ta' ? /[஀-௿]/ : /[ಀ-೿]/;
      const findings: Finding[] = [];
      const root = document.querySelector(selector);
      if (!root) return [{ kind: 'scope', text: selector, detail: 'not found' }];

      // Headings, labels and emphasis use the tighter Indic heading leading (typography.css).
      const NOT_BODY =
        'h1, h2, h3, h4, h5, h6, .heading, .display, .eyebrow, label, .label, b, strong, th';
      const ownText = (el: Element) =>
        [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join('')
          .trim();

      for (const el of root.querySelectorAll('*')) {
        const text = ownText(el);
        if (!text || !script.test(text)) continue;
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        // Visually hidden (sr-only, e.g. the skip link until focused) is clipped on purpose.
        if (rect.width <= 1 || rect.height <= 1 || style.clipPath !== 'none') continue;
        const short = text.slice(0, 40);
        // Marked for the glyph check, which reads the fonts Chromium used (platformFonts).
        el.setAttribute('data-indic-audit', short);

        if (text.includes('�')) findings.push({ kind: 'tofu', text: short, detail: 'U+FFFD' });
        if (!style.fontFamily.includes(family)) {
          findings.push({ kind: 'font', text: short, detail: style.fontFamily });
        }

        const fontSize = Number.parseFloat(style.fontSize);
        const lineHeight = Number.parseFloat(style.lineHeight);
        if (!el.closest(NOT_BODY) && fontSize <= 18) {
          if (Number.isNaN(lineHeight) || lineHeight / fontSize < 1.7 - 0.01) {
            findings.push({
              kind: 'line-height',
              text: short,
              detail: `${style.lineHeight} / ${style.fontSize} (${el.tagName.toLowerCase()}.${el.className})`,
            });
          }
        }
        if (style.letterSpacing !== 'normal' && Number.parseFloat(style.letterSpacing) !== 0) {
          findings.push({ kind: 'letter-spacing', text: short, detail: style.letterSpacing });
        }
        if (style.textTransform !== 'none') {
          findings.push({ kind: 'text-transform', text: short, detail: style.textTransform });
        }

        // Clipped or truncated: a box that hides overflow and has more content than room.
        const hides = (value: string) => value === 'hidden' || value === 'clip';
        if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
          findings.push({ kind: 'truncated', text: short, detail: 'ellipsis' });
        }
        if (hides(style.overflowX) && el.scrollWidth > el.clientWidth + 1) {
          findings.push({
            kind: 'clipped',
            text: short,
            detail: `${String(el.scrollWidth)} > ${String(el.clientWidth)}`,
          });
        }
        if (hides(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
          findings.push({
            kind: 'clipped',
            text: short,
            detail: `${String(el.scrollHeight)} > ${String(el.clientHeight)}`,
          });
        }
        if (rect.right > document.documentElement.clientWidth + 1 || rect.left < -1) {
          findings.push({
            kind: 'off-screen',
            text: short,
            detail: `${String(rect.left)}..${String(rect.right)}`,
          });
        }

        // Buttons: the label wraps rather than overflowing the button.
        const button = el.closest('button');
        if (button && button.scrollWidth > button.clientWidth + 1) {
          findings.push({
            kind: 'button-overflow',
            text: short,
            detail: `${String(button.scrollWidth)} > ${String(button.clientWidth)}`,
          });
        }
      }
      return findings;
    },
    { lang: locale, family: FAMILY[locale], scope },
  );
}

/** The font files Chromium shaped each element's own text with (CDP `CSS.getPlatformFontsForNode`). */
const SHIPPED_FACE = { ta: 'Noto Sans Tamil', kn: 'Noto Sans Kannada' } as const;

/**
 * No tofu and no silent fallback: every element `audit` marked is rendered with the shipped Noto
 * face for its script, and no glyph comes from a system font (a glyph missing from our faces would
 * either fall back to one or draw a .notdef box). Correct conjuncts follow from shaping in that face.
 */
async function glyphs(page: Page, locale: IndicLocale): Promise<Finding[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: '[data-indic-audit]',
    });
    const findings: Finding[] = [];
    for (const nodeId of nodeIds) {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      const { attributes } = await cdp.send('DOM.getAttributes', { nodeId });
      const text = attributes[attributes.indexOf('data-indic-audit') + 1] ?? '';
      const used = fonts.filter((font) => font.glyphCount > 0);
      if (!used.some((font) => font.isCustomFont && font.familyName === SHIPPED_FACE[locale])) {
        findings.push({ kind: 'tofu', text, detail: `not set in ${SHIPPED_FACE[locale]}` });
      }
      for (const font of used.filter((f) => !f.isCustomFont)) {
        findings.push({ kind: 'tofu', text, detail: `fallback to ${font.familyName}` });
      }
    }
    return findings;
  } finally {
    await cdp.detach();
  }
}

/** Layout/typography findings plus glyph findings for `scope`. */
async function inspect(page: Page, locale: IndicLocale, scope = 'body'): Promise<Finding[]> {
  const layout = await audit(page, locale, scope);
  return [...layout, ...(await glyphs(page, locale))];
}

for (const locale of INDIC) {
  test.describe(`Indic rendering: ${locale}`, () => {
    test('specimen: line-height, wrapping, numerals and per-script sizing', async ({ page }) => {
      await openSignIn(page, locale);
      await injectSpecimen(page, locale);
      await indicFontReady(page, locale);
      const specimen = page.locator(`[data-specimen="${locale}"]`);

      expect(await inspect(page, locale, `[data-specimen="${locale}"]`)).toEqual([]);

      // Body text in every size step is at least 1.7.
      for (const selector of ['p.text-base', 'p.prose', 'div.text-sm', 'span.text-xs']) {
        const ratio = await specimen
          .locator(selector)
          .first()
          .evaluate((el) => {
            const style = getComputedStyle(el);
            return Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize);
          });
        expect(ratio, selector).toBeGreaterThanOrEqual(1.69);
      }

      // The long label wraps inside the viewport; at 360 px it takes two lines or more.
      const button = specimen.locator('[data-specimen-button]');
      const box = await button.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          right: rect.right,
          height: rect.height,
          line: Number.parseFloat(style.lineHeight),
          whiteSpace: style.whiteSpace,
          overflow: el.scrollWidth - el.clientWidth,
          viewport: document.documentElement.clientWidth,
        };
      });
      expect(box.right).toBeLessThanOrEqual(box.viewport);
      expect(box.overflow).toBeLessThanOrEqual(1);
      if (page.viewportSize()?.width === 360) {
        expect(box.whiteSpace).not.toBe('nowrap');
        expect(box.height).toBeGreaterThanOrEqual(box.line * 2);
      }

      // Numerals: Latin face first in the stack, tabular figures.
      for (const selector of ['time', '[data-inr]', 'span.num']) {
        const style = await specimen.locator(selector).evaluate((el) => {
          const computed = getComputedStyle(el);
          return { family: computed.fontFamily, numeric: computed.fontVariantNumeric };
        });
        expect(style.family.split(',')[0], selector).toMatch(/geist/i);
        expect(style.numeric, selector).toContain('tabular-nums');
      }

      // Per-script sizing: the Indic @font-face carries a size-adjust below 100%.
      const sizeAdjust = await page.evaluate((family) => {
        for (const sheet of document.styleSheets) {
          for (const rule of sheet.cssRules) {
            if (!(rule instanceof CSSFontFaceRule)) continue;
            if (rule.style.getPropertyValue('font-family').replaceAll(/['"]/g, '') !== family)
              continue;
            return rule.style.getPropertyValue('size-adjust');
          }
        }
        return null;
      }, FAMILY[locale]);
      expect(sizeAdjust).toMatch(/^\d+(\.\d+)?%$/);
      expect(Number.parseFloat(sizeAdjust ?? '100')).toBeLessThan(100);
    });

    test('sign-in page', async ({ page }) => {
      await openSignIn(page, locale);
      await indicFontReady(page, locale);
      expect(await inspect(page, locale)).toEqual([]);
    });

    test('shell', async ({ page, asUser, db }) => {
      await setOwnerLocale(db.name, locale);
      await openShell(page, asUser);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await indicFontReady(page, locale);
      expect(await inspect(page, locale)).toEqual([]);
    });
  });

  test.describe(`Indic rendering baselines: ${locale}`, { tag: '@visual' }, () => {
    test('specimen', async ({ page }, testInfo) => {
      const name = `specimen-${locale}.png`;
      skipWithoutBaseline(testInfo, name);
      await openSignIn(page, locale);
      await injectSpecimen(page, locale);
      await indicFontReady(page, locale);
      await expect(page.locator(`[data-specimen="${locale}"]`)).toHaveScreenshot(name);
    });

    test('sign-in', async ({ page }, testInfo) => {
      const name = `sign-in-${locale}.png`;
      skipWithoutBaseline(testInfo, name);
      await openSignIn(page, locale);
      await indicFontReady(page, locale);
      // From 1024 px the email field takes focus once the page has hydrated (magic-link-form.tsx),
      // so the ring is part of the settled page. Wait for it: a shot taken before it (the first
      // sign-in-ta baseline) differs from every later run.
      if ((page.viewportSize()?.width ?? 0) >= 1024) {
        await expect(page.locator('input[type="email"]')).toBeFocused();
      }
      await expect(page).toHaveScreenshot(name, {
        fullPage: true,
        mask: [page.locator('[data-testid="dynamic"]')],
      });
    });

    test('shell', async ({ page, asUser, db }, testInfo) => {
      const name = `shell-${locale}.png`;
      skipWithoutBaseline(testInfo, name);
      await setOwnerLocale(db.name, locale);
      await openShell(page, asUser);
      await indicFontReady(page, locale);
      await expect(page).toHaveScreenshot(name);
    });
  });
}
