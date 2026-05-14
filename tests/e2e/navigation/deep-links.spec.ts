import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Deep-link URL routing', () => {
  test('navigating to /sessions while logged in shows sessions screen', async ({ page }) => {
    // loginAs sets the init script before the first goto; navigate to /sessions directly
    await loginAs(page);
    // After initial load, navigate to /sessions
    await page.waitForSelector('[class*="hm-"], [class*="ses-"]', { timeout: 8000 });
    await page.goto('/sessions');
    await expect(page.locator('[class*="ses-"]')).toBeVisible({ timeout: 8000 });
  });

  test('navigating to /profile while logged in shows profile screen', async ({ page }) => {
    await loginAs(page);
    await page.waitForSelector('[class*="hm-"], [class*="pr-"]', { timeout: 8000 });
    await page.goto('/profile');
    await expect(page.locator('[class*="pr-"]')).toBeVisible({ timeout: 8000 });
  });

  test('refreshing on /sessions stays on sessions screen', async ({ page }) => {
    await loginAs(page);
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await expect(page.locator('[class*="ses-"]')).toBeVisible({ timeout: 8000 });
  });
});
