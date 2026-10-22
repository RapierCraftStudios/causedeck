// Account security (#289): `/account` adds and removes a passkey (CDP virtual authenticator), sets
// up TOTP two-factor through the 3-step dialog (QR, verify with a code computed from the shown key,
// backup codes shown once with Copy and Download), and revokes another session, which is signed out
// on its very next request. Also: the empty states, offline (read-only with the banner), loading
// and error previews, no horizontal scroll at 360 px, and axe with every dialog open (`@a11y` runs
// axe on the page the test ends on; mid-test checks call `a11y.expectNoViolations`). Every test
// starts from the reset e2e seed, so 2FA and sessions never leak between tests.
import { createHmac } from 'node:crypto';

import type { Page } from '@playwright/test';

import { e2eUser, expect, test } from '../../fixtures/index.ts';
import type { AsUser } from '../../fixtures/auth.ts';

async function openAccount(page: Page, asUser: AsUser, query = '') {
  await asUser('owner');
  await page.goto(`/account${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  // The title streams in after the page body; axe's document-title rule needs it present.
  await expect.poll(() => page.title()).not.toBe('');
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret. */
function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

test.describe('account security', () => {
  test(
    'empty states: no passkeys, no other sessions, a labelled session table',
    { tag: '@a11y' },
    async ({ page, asUser }) => {
      await openAccount(page, asUser);
      await expect(
        page.getByText('No passkeys yet. Add one to sign in with your fingerprint or screen lock.'),
      ).toBeVisible();
      const table = page.getByRole('table', { name: 'Your active sessions' });
      await expect(table).toBeVisible();
      await expect(table.getByText('This device')).toBeVisible();
      await expect(page.getByText('No other active sessions.')).toBeVisible();
      await expect(page.getByText('Off', { exact: true })).toBeVisible();
    },
  );

  test(
    'adds and removes a passkey with a virtual authenticator',
    { tag: '@a11y' },
    async ({ page, asUser, browserName, a11y }) => {
      test.skip(
        browserName !== 'chromium',
        'virtual authenticators need the Chrome DevTools Protocol',
      );
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
      await openAccount(page, asUser);
      await page.getByRole('button', { name: 'Add passkey' }).click();
      await expect(page.getByText('Passkey added.')).toBeVisible();
      const list = page.getByRole('list', { name: 'Your passkeys' });
      await expect(list.getByRole('listitem')).toHaveCount(1);

      await list.getByRole('button', { name: /^Remove / }).click();
      const dialog = page.getByRole('alertdialog', { name: 'Remove this passkey?' });
      await expect(dialog).toBeVisible();
      await a11y.expectNoViolations(page);
      await dialog.getByRole('button', { name: 'Remove passkey' }).click();
      await expect(page.getByText('Passkey removed.')).toBeVisible();
      await expect(
        page.getByText('No passkeys yet. Add one to sign in with your fingerprint or screen lock.'),
      ).toBeVisible();
    },
  );

  test(
    'sets up TOTP two-factor: QR, verify, backup codes shown once with Copy and Download',
    { tag: '@a11y' },
    async ({ page, asUser, a11y }) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await openAccount(page, asUser);
      const setUp = page.getByRole('button', { name: 'Set up' });
      await setUp.click();
      const dialog = page.getByRole('dialog', { name: 'Set up two-factor authentication' });
      await expect(dialog.getByText('Step 1 of 3')).toBeVisible();
      const qr = dialog.getByRole('img', { name: 'QR code for your authenticator app' });
      await expect(qr).toBeVisible();
      // White surface with a quiet zone, whatever the theme.
      await expect(dialog.locator('[data-slot="two-factor-qr"]')).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)',
      );
      await expect(dialog.getByRole('heading', { name: 'Scan the QR code' })).toBeFocused();
      await a11y.expectNoViolations(page);
      const secret = (await dialog.locator('[data-slot="two-factor-secret"]').textContent()) ?? '';
      expect(secret).toMatch(/^[A-Z2-7]+=*$/);

      await dialog.getByRole('button', { name: 'Next' }).click();
      const code = dialog.getByRole('textbox', { name: 'Code' });
      await expect(code).toBeFocused();
      await code.fill('000000');
      await page.keyboard.press('Enter');
      await expect(
        dialog.getByText('That code did not work. Check the time on your phone and try again.'),
      ).toBeVisible();
      await a11y.expectNoViolations(page);
      await code.fill(totp(secret));
      await dialog.getByRole('button', { name: 'Verify' }).click();

      const codes = dialog.getByRole('list', { name: 'Backup codes' });
      await expect(codes).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Save your backup codes' })).toBeFocused();
      const shown = await codes.getByRole('listitem').allTextContents();
      expect(shown.length).toBeGreaterThan(0);
      await dialog.getByRole('button', { name: 'Copy' }).click();
      await expect(page.getByText('Backup codes copied.')).toBeVisible();
      const downloading = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Download' }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe('causedeck-backup-codes.txt');
      await a11y.expectNoViolations(page);
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();

      // On, and the codes are gone for good; verification rotated the session and it still works.
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
      await expect(page.getByText('On', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Set up' })).toHaveCount(0);
      for (const backupCode of shown) await expect(page.getByText(backupCode)).toHaveCount(0);
    },
  );

  test(
    'revokes another session; it is signed out on its next request',
    { tag: '@a11y' },
    async ({ page, asUser, browser, readMagicLink, a11y }) => {
      // A second device: the same owner signed in by magic link in another browser context.
      const other = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
      });
      try {
        const phone = await other.newPage();
        const { email } = e2eUser('owner');
        await phone.goto('/sign-in?next=/account');
        await phone.getByLabel('Email', { exact: true }).fill(email);
        await phone.getByRole('button', { name: 'Email me a sign-in link' }).click();
        await expect(phone.getByText(email)).toBeVisible();
        await phone.goto(await readMagicLink(email));
        await expect(phone).toHaveURL((url) => url.pathname === '/account');

        await openAccount(page, asUser);
        await page.getByRole('button', { name: 'Revoke the session on Firefox on Linux' }).click();
        const dialog = page.getByRole('alertdialog', { name: 'Revoke this session?' });
        await expect(dialog).toBeVisible();
        await a11y.expectNoViolations(page);
        await dialog.getByRole('button', { name: 'Revoke session' }).click();
        await expect(page.getByText('Session revoked.')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Revoke the session on Firefox on Linux' }),
        ).toHaveCount(0);

        // The very next request from the revoked device is signed out.
        await phone.goto('/account');
        await expect(phone).toHaveURL((url) => url.pathname === '/sign-in');
      } finally {
        await other.close();
      }
    },
  );

  test('offline: read-only with the banner', async ({ page, asUser }) => {
    await openAccount(page, asUser);
    await page.context().setOffline(true);
    await expect(page.getByText('Settings can be changed when you are back online.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add passkey' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Set up' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await page.context().setOffline(false);
    await expect(page.getByRole('button', { name: 'Set up' })).toBeEnabled();
  });

  test('loading and error states (dev previews)', async ({ page, asUser }) => {
    await openAccount(page, asUser, '?__state=loading');
    await expect(page.locator('main [data-pattern-state="loading"]')).toBeVisible();
    await page.goto('/account?__state=error');
    await expect(page.getByText('Could not load your account.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('profile: saves the name, initials follow', { tag: '@a11y' }, async ({ page, asUser }) => {
    await openAccount(page, asUser);
    const name = page.getByRole('textbox', { name: 'Name' });
    await name.fill('Meera Krishnan');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Meera Krishnan');
    await expect(page.getByRole('img', { name: 'Meera Krishnan' })).toHaveText('MK');
  });

  test('no horizontal scroll at 360 px', async ({ page, asUser }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openAccount(page, asUser);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
