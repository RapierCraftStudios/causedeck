import { expect, test } from '../../fixtures/index.ts';

// The console SMS sender (CI default) logs the code to the server, which the browser cannot read, so
// this covers the phone-first form up to the code step; the full OTP round trip runs in
// packages/auth's phone-otp tests.
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
});
