import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockSessionsList, mockSessionDetail } from '../helpers/mock-api';

test.describe('Back button in Chat', () => {
  test('back from chat (opened from home) returns to home', async ({ page }) => {
    await loginAs(page);
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });

    // Open chat from home by clicking compose
    const chip = page.locator('[class*="hm-chip"]').first();
    await expect(chip).toBeVisible({ timeout: 5000 });
    await chip.click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });

    // Click back button
    const back = page.locator('[class*="ch-back"], button[aria-label*="back" i]').first();
    await expect(back).toBeVisible({ timeout: 5000 });
    await back.click();
    await expect(page.locator('[class*="hm-"]')).toBeVisible({ timeout: 5000 });
  });

  test('back from chat (opened from sessions) returns to sessions', async ({ page }) => {
    await loginAs(page);
    await mockSessionsList(page, [
      { id: 's1', title: 'My Session', when: '1 day ago', turnCount: 2, group: 'This week' },
    ]);
    await mockSessionDetail(page, 's1', {
      title: 'My Session',
      turns: [{ userMessage: 'Hello', responseText: 'Hi there' }],
    });

    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await page.waitForSelector('[class*="ses-"]', { timeout: 8000 });

    await page.locator('[class*="ses-row"]').first().click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });

    const back = page.locator('[class*="ch-back"], button[aria-label*="back" i]').first();
    await expect(back).toBeVisible({ timeout: 5000 });
    await back.click();
    await expect(page.locator('[class*="ses-"]')).toBeVisible({ timeout: 5000 });
  });
});
