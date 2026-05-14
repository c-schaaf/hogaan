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

  test('clicking Sessions tab then refreshing stays on sessions (not bounced to home)', async ({
    page,
  }) => {
    await loginAs(page);
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });

    // Click the ACTUAL Sessions nav tab — lets the app write to sessionStorage naturally
    await page
      .locator('.hm-nav-tab, .hm-side-tab', { hasText: /sessions/i })
      .first()
      .click();
    await expect(page.locator('[class*="ses-"]')).toBeVisible({ timeout: 5000 });

    // Hard refresh — must stay on Sessions, not bounce to Home
    await page.reload();
    await expect(page.locator('[class*="ses-"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[class*="hm-chip"], [class*="hm-greet"]')).not.toBeVisible();
  });

  test('clicking Profile tab then refreshing stays on profile (not bounced to home)', async ({
    page,
  }) => {
    await loginAs(page);
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });

    // Click the ACTUAL Profile nav tab
    await page
      .locator('.hm-nav-tab, .hm-side-tab', { hasText: /profile/i })
      .first()
      .click();
    await expect(page.locator('[class*="pr-"]')).toBeVisible({ timeout: 5000 });

    // Hard refresh — must stay on Profile, not bounce to Home
    await page.reload();
    await expect(page.locator('[class*="pr-"]')).toBeVisible({ timeout: 8000 });
  });
});
