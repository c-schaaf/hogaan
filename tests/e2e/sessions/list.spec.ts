import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockSessionsList } from '../helpers/mock-api';

test.describe('Sessions list', () => {
  test('shows grouped sessions', async ({ page }) => {
    await loginAs(page);
    await mockSessionsList(page, [
      { id: 's1', title: 'Team Leadership Discussion', when: '2 days ago', turnCount: 5, group: 'This week' },
      { id: 's2', title: 'Conflict Resolution Strategy', when: '15 days ago', turnCount: 3, group: 'Earlier this month' },
    ]);

    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    // Navigate to sessions
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await page.waitForSelector('[class*="ses-"]', { timeout: 8000 });

    await expect(page.getByText('This week')).toBeVisible();
    await expect(page.getByText('Team Leadership Discussion')).toBeVisible();
  });

  test('shows empty state when no sessions', async ({ page }) => {
    await loginAs(page);
    // /api/sessions already mocked to return [] by loginAs

    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await page.waitForSelector('[class*="ses-"]', { timeout: 8000 });

    await expect(page.getByText(/saved conversations will live here/i)).toBeVisible({ timeout: 5000 });
  });

  test('search filters sessions by title', async ({ page }) => {
    await loginAs(page);
    await mockSessionsList(page, [
      { id: 's1', title: 'Team Leadership', when: '1 day ago', turnCount: 3, group: 'This week' },
      { id: 's2', title: 'Budget Planning', when: '2 days ago', turnCount: 2, group: 'This week' },
    ]);

    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await page.waitForSelector('[class*="ses-search"]', { timeout: 8000 });

    await page.locator('[class*="ses-search"] input').fill('Team');
    await expect(page.getByText('Team Leadership')).toBeVisible();
    await expect(page.getByText('Budget Planning')).not.toBeVisible();
  });
});
