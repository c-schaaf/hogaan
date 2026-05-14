import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockSessionsList } from '../helpers/mock-api';

test.describe('Sessions search', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await mockSessionsList(page, [
      { id: 's1', title: 'Team Leadership', when: '1 day ago', turnCount: 3, group: 'This week' },
      { id: 's2', title: 'Conflict Resolution', when: '2 days ago', turnCount: 2, group: 'This week' },
      { id: 's3', title: 'Strategic Thinking', when: '10 days ago', turnCount: 4, group: 'Earlier this month' },
    ]);

    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await page.waitForSelector('[class*="ses-search"]', { timeout: 8000 });
  });

  test('typing partial title shows only matching sessions', async ({ page }) => {
    await page.locator('[class*="ses-search"] input').fill('Team');

    await expect(page.getByText('Team Leadership')).toBeVisible();
    await expect(page.getByText('Conflict Resolution')).not.toBeVisible();
    await expect(page.getByText('Strategic Thinking')).not.toBeVisible();
  });

  test('clearing search shows all sessions', async ({ page }) => {
    await page.locator('[class*="ses-search"] input').fill('Team');
    await expect(page.getByText('Conflict Resolution')).not.toBeVisible();

    await page.locator('[class*="ses-search"] input').fill('');
    await expect(page.getByText('Team Leadership')).toBeVisible();
    await expect(page.getByText('Conflict Resolution')).toBeVisible();
  });

  test('no-match message when search has no results', async ({ page }) => {
    await page.locator('[class*="ses-search"] input').fill('zzznomatch');
    await expect(page.getByText(/No sessions match/)).toBeVisible();
  });
});
