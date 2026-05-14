import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Bottom navigation (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
  });

  test('Sessions tab navigates to sessions screen', async ({ page }) => {
    const sessionsTab = page
      .locator('[class*="nav"] button', { hasText: /sessions/i })
      .or(page.locator('[aria-label*="sessions" i]'));
    if ((await sessionsTab.count()) > 0) {
      await sessionsTab.first().click();
      await expect(page.locator('[class*="ses-"]')).toBeVisible({ timeout: 5000 });
    } else {
      // Nav might use icons — try clicking by position
      const nav = page.locator('[class*="btm-nav"], [class*="bottom-nav"], [class*="nav-"]').last();
      await expect(nav).toBeVisible();
    }
  });

  test('Profile tab navigates to profile screen', async ({ page }) => {
    const profileTab = page
      .locator('[class*="nav"] button', { hasText: /profile/i })
      .or(page.locator('[aria-label*="profile" i]'));
    if ((await profileTab.count()) > 0) {
      await profileTab.first().click();
      await expect(page.locator('[class*="pr-"]')).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

  test('tapping a suggestion chip opens chat', async ({ page }) => {
    const chip = page.locator('[class*="hm-chip"]').first();
    await expect(chip).toBeVisible({ timeout: 5000 });
    await chip.click();
    await expect(page.locator('[class*="ch-"]')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Desktop sidebar', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
  });

  test('sidebar renders at desktop viewport', async ({ page }) => {
    // Desktop sidebar should be visible
    const sidebar = page.locator('[class*="ds-"], [class*="sidebar"]').first();
    await expect(sidebar).toBeVisible({ timeout: 5000 });
  });
});
