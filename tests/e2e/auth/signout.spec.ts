import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Sign out', () => {
  test('sign out from profile navigates to login', async ({ page }) => {
    await loginAs(page);
    // Navigate to profile
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    await page.route('**/auth/v1/logout', (route) => route.fulfill({ status: 204, body: '' }));
    // Find and click nav to profile
    const profileNav = page.locator('[class*="nav"] button', { hasText: /profile/i })
      .or(page.locator('[aria-label*="profile" i]'));
    if (await profileNav.count() > 0) {
      await profileNav.first().click();
    } else {
      // Set shell-phase directly
      await page.evaluate(() => sessionStorage.setItem('shell-phase', 'profile'));
      await page.reload();
    }
    await expect(page.locator('button', { hasText: 'Sign out' })).toBeVisible({ timeout: 5000 });
    await page.locator('button', { hasText: 'Sign out' }).click();
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 8000 });
  });
});
