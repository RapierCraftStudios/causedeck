import { expect, test } from '../../fixtures/index.ts';

// The console SMS sender only logs the code, so the specs read it from the worker database through
// `readPhoneOtp` (fixtures/auth.ts), the way `readMagicLink` reads the email from Mailpit.

/** A fresh Indian mobile (10 digits starting 6-9) per test; the database is reset between tests. */
function newPhone(): { national: string; e164: string } {
  const national = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return { national, e164: `+91${national}` };
}

test.describe('phone sign-in', () => {
  test('rejects a number that is not a 10-digit Indian mobile', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Mobile number').fill('12345');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Enter a 10-digit Indian mobile number.')).toBeVisible();
  });

  test('asks for the code after a valid number', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText(/We texted a 6-digit code to \+919876543210/)).toBeVisible();
    await expect(page.getByLabel('Code')).toBeVisible();
  });

  test('signs up, signs out, then signs in again with a fresh code', async ({
    page,
    readPhoneOtp,
  }) => {
    const { national, e164 } = newPhone();

    // Sign up: a new number, its code, and the session lands in the app.
    await page.goto('/sign-in');
    await page.getByLabel('Mobile number').fill(national);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText(new RegExp(`We texted a 6-digit code to \\${e164}`))).toBeVisible();
    const firstCode = await readPhoneOtp(e164);
    await page.getByLabel('Code').fill(firstCode);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    // A new account has no workspace, so it lands on `/onboarding`. The root `loading.tsx` streams
    // `/`, which makes its redirect a client-side one: wait for the final page, or the next `goto`
    // races that redirect and aborts.
    await page.waitForURL('**/onboarding');

    const session = async () =>
      (await (await page.request.get('/api/auth/get-session')).json()) as {
        user?: { phoneNumber?: string; phoneNumberVerified?: boolean };
      } | null;
    expect((await session())?.user).toMatchObject({
      phoneNumber: e164,
      phoneNumberVerified: true,
    });
    // A signed-in visitor is bounced off the sign-in page.
    await page.goto('/sign-in', { waitUntil: 'commit' });
    await page.waitForURL('**/onboarding');

    // Sign out (the user menu has no sign-out action yet, so use the auth endpoint).
    const signOut = await page.request.post('/api/auth/sign-out', {
      data: {},
      headers: { origin: new URL(page.url()).origin },
    });
    expect(signOut.status(), await signOut.text()).toBe(200);
    await page.context().clearCookies();
    expect(await session()).toBeNull();
    await page.goto('/sign-in', { waitUntil: 'commit' });
    await expect(page.getByLabel('Mobile number')).toBeVisible();

    // Sign in again: a new code is issued, and it is the same account.
    await page.getByLabel('Mobile number').fill(national);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('Code')).toBeVisible();
    const secondCode = await readPhoneOtp(e164);
    await page.getByLabel('Code').fill(secondCode);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'));
    expect((await session())?.user?.phoneNumber).toBe(e164);
  });

  test('rejects a wrong code and keeps the visitor signed out', async ({ page, readPhoneOtp }) => {
    const { national, e164 } = newPhone();
    await page.goto('/sign-in');
    await page.getByLabel('Mobile number').fill(national);
    await page.getByRole('button', { name: 'Send code' }).click();
    const real = await readPhoneOtp(e164);
    const wrong = real === '000000' ? '000001' : '000000';

    await page.getByLabel('Code').fill(wrong);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByText('That code is not right. Check it and try again.')).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
    const body = (await (await page.request.get('/api/auth/get-session')).json()) as unknown;
    expect(body).toBeNull();
  });

  test('locks a code after three wrong attempts, even for the right code', async ({
    page,
    readPhoneOtp,
  }) => {
    const { national, e164 } = newPhone();
    await page.goto('/sign-in');
    await page.getByLabel('Mobile number').fill(national);
    await page.getByRole('button', { name: 'Send code' }).click();
    const real = await readPhoneOtp(e164);
    const wrong = real === '000000' ? '000001' : '000000';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByLabel('Code').fill(wrong);
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
      await expect(page.getByText('That code is not right. Check it and try again.')).toBeVisible();
    }
    await page.getByLabel('Code').fill(real);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByText('Too many wrong attempts. Request a new code.')).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('rejects an expired code', async ({ page, readPhoneOtp, expirePhoneOtp }) => {
    const { national, e164 } = newPhone();
    await page.goto('/sign-in');
    await page.getByLabel('Mobile number').fill(national);
    await page.getByRole('button', { name: 'Send code' }).click();
    const code = await readPhoneOtp(e164);
    await expirePhoneOtp(e164);

    await page.getByLabel('Code').fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByText('This code has expired. Request a new one.')).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
