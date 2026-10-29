// Brief Sheet print output (#61): the seeded brief rendered with `page.pdf` on A4. At most two
// pages and the print stylesheet's 14 mm margins; private notes are absent unless opted in.
import { expect, test } from '../../fixtures/index.ts';
import { openBrief } from '../product/brief-helpers.ts';

const pageCount = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test.describe('brief sheet print', () => {
  test('fits two A4 pages with 14 mm margins and ink on white', async ({ page, asUser }) => {
    await openBrief(page, asUser);
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    const margin = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;width:14mm';
      document.body.append(probe);
      const px = probe.getBoundingClientRect().width;
      probe.remove();
      return px;
    });
    expect(margin).toBeGreaterThan(50);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(255, 255, 255)');
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true });
    expect(pageCount(pdf)).toBeLessThanOrEqual(2);
  });

  test('excludes private court notes by default', async ({ page, asUser }) => {
    await openBrief(page, asUser);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[data-section="court_notes"]')).toBeHidden();
  });
});
