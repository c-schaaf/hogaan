import { expect, test } from '@playwright/test';
import { loginAs, FAKE_ME } from '../helpers/auth';

async function goToProfile(page: import('@playwright/test').Page) {
  await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
  await page.evaluate(() => sessionStorage.setItem('shell-phase', 'profile'));
  await page.reload();
  await page.waitForSelector('[class*="pr-"]', { timeout: 8000 });
}

test.describe('Profile view and edit', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('shows user name and email', async ({ page }) => {
    await goToProfile(page);
    await expect(page.getByText(FAKE_ME.fullName)).toBeVisible();
    await expect(page.getByText(FAKE_ME.email)).toBeVisible();
  });

  test('shows practices in focus count', async ({ page }) => {
    await goToProfile(page);
    await expect(page.getByText(/practices in focus/i)).toBeVisible();
  });

  test('support email link is present', async ({ page }) => {
    await goToProfile(page);
    await expect(page.locator('a[href="mailto:hamse24@gmail.com"]')).toBeVisible();
  });

  test('"Update practices" button enters edit mode', async ({ page }) => {
    await goToProfile(page);
    await page.locator('button', { hasText: 'Update practices' }).click();
    await expect(page.locator('button', { hasText: 'Save' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Cancel' })).toBeVisible();
  });

  test('Cancel exits edit mode without saving', async ({ page }) => {
    await page.route('**/api/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ status: 200, body: '{"ok":true}' });
      }
      return route.continue();
    });
    await goToProfile(page);
    await page.locator('button', { hasText: 'Update practices' }).click();
    await page.locator('button', { hasText: 'Cancel' }).click();
    await expect(page.locator('button', { hasText: 'Update practices' })).toBeVisible();
  });
});
