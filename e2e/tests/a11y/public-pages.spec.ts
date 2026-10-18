import { expect, test } from '../../fixtures/index.ts';

// `@a11y`: the fixture runs axe (serious + critical) after each test, on the page it ended on.
test.describe('public pages are accessible', { tag: '@a11y' }, () => {
  // The sign-in editorial pane's numerals are an `aria-hidden` texture (pure decoration, which
  // WCAG 1.4.3 exempts from contrast); everything a user reads or operates is still checked.
  test.use({ a11yOptions: { exclude: ['aside ol[aria-hidden="true"]'] } });

  test('sign-in', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('sign-in, check your email', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email', { exact: true }).fill('viewer@chennai-solo.e2e.test');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByText('viewer@chennai-solo.e2e.test')).toBeVisible();
  });

  test('offline', async ({ page }) => {
    await page.goto('/offline');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('a11y.expectNoViolations', () => {
  test('fails on a serious violation and names the offending node', async ({ page, a11y }) => {
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>bad</title></head><body><main><h1>Bad</h1>' +
        '<img id="no-alt" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></body></html>',
    );
    const error = await a11y.expectNoViolations(page).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toContain('image-alt');
    expect(error?.message).toContain('#no-alt');
  });

  test('passes a clean page', async ({ page, a11y }) => {
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>ok</title></head><body><main><h1>Fine</h1>' +
        '</main></body></html>',
    );
    await a11y.expectNoViolations(page);
  });
});
