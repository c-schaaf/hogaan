import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Profile practices editing', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, { practices: ['Integrity', 'Peace', 'Empathy'] });
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'profile'));
    await page.reload();
    await page.waitForSelector('[class*="pr-"]', { timeout: 8000 });
  });

  test('PATCH /api/profile called with updated practices on Save', async ({ page }) => {
    let patchBody: Record<string, unknown> | null = null;
    await page.route('**/api/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      return route.continue();
    });

    await page.locator('button', { hasText: 'Update practices' }).click();
    // Toggle Empathy (currently on — click to deselect)
    const empathyBtn = page.locator('[class*="pr-prac-pill"]', { hasText: 'Empathy' });
    await empathyBtn.click();
    await page.locator('button', { hasText: 'Save' }).click();

    await page.waitForTimeout(500);
    expect(patchBody?.mappedPractices).toBeDefined();
    expect((patchBody?.mappedPractices as string[]).includes('Empathy')).toBe(false);
  });
});
