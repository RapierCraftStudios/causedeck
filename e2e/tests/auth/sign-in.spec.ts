import { e2eUser, expect, test } from '../../fixtures/index.ts';

test.describe('sign-in', () => {
  test(
    'magic link from the mailer (Mailpit) signs the user in',
    { tag: '@smoke' },
    async ({ page, readMagicLink }) => {
      const { email } = e2eUser('advocate');
      await page.goto('/sign-in?next=/account');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
      await expect(page.getByText(email)).toBeVisible();

      await page.goto(await readMagicLink(email));
      await expect(page).toHaveURL((url) => url.pathname === '/account');
      await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
    },
  );

  test('magic link honours a safe `next`', async ({ page, readMagicLink }) => {
    const { email } = e2eUser('junior');
    await page.goto('/sign-in?next=%2Fw%2Fchennai-solo%2Ftoday');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByText(email)).toBeVisible();

    await page.goto(await readMagicLink(email));
    await expect(page).toHaveURL((url) => url.pathname === '/w/chennai-solo/today');
  });

  test('passkey via a virtual authenticator', async ({ page, asUser, browserName }) => {
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

    // Register a passkey while signed in (the account UI for it arrives later; call the API).
    await asUser('owner', { path: 'today' });
    await page.goto('/account');
    const registered = await page.evaluate(async () => {
      const options: unknown = await (
        await fetch('/api/auth/passkey/generate-register-options')
      ).json();
      const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(
        options as PublicKeyCredentialCreationOptionsJSON,
      );
      const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
      const json: unknown = credential.toJSON();
      const response = await fetch('/api/auth/passkey/verify-registration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response: json, name: 'e2e virtual authenticator' }),
      });
      return response.status;
    });
    expect(registered).toBe(200);

    // Signed out, the passkey alone signs the user back in and honours `next`.
    await page.context().clearCookies();
    // Test the button ceremony alone: with conditional UI on, the autofocused email field (>= 1024
    // px) lets the virtual authenticator finish a second, racing ceremony by itself.
    await page.addInitScript(() => {
      PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
    });
    await page.goto('/sign-in?next=/account');
    await page.getByTestId('passkey-sign-in').click();
    await expect(page).toHaveURL((url) => url.pathname === '/account');
    await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  });
});
