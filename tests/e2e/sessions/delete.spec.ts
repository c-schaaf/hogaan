import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockSessionsList } from '../helpers/mock-api';

test.describe('Delete session', () => {
  test('the delete control removes a row and fires DELETE /api/sessions/:id', async ({ page }) => {
    const SESSION_ID = 'sess-del-001';
    await loginAs(page);
    await mockSessionsList(page, [
      {
        id: SESSION_ID,
        title: 'Session to Delete',
        when: '1 day ago',
        turnCount: 3,
        group: 'This week',
      },
    ]);

    // Auto-confirm the window.confirm dialog.
    page.on('dialog', (dialog) => void dialog.accept());

    let deleteFired = false;
    await page.route(`**/api/sessions/${SESSION_ID}`, (route) => {
      if (route.request().method() === 'DELETE') {
        deleteFired = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      }
      return route.continue();
    });

    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await page.waitForSelector('[class*="ses-"]', { timeout: 8000 });

    const row = page.locator('.ses-row-wrap', { hasText: 'Session to Delete' });
    await expect(row).toBeVisible({ timeout: 5000 });

    // The delete button is hover-revealed; force-click to bypass hover state.
    await row.locator('button.ses-row-del').click({ force: true });

    await expect(row).toHaveCount(0, { timeout: 5000 });
    expect(deleteFired).toBe(true);
  });
});
