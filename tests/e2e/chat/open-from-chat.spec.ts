import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockSessionDetail, mockSessionsList } from '../helpers/mock-api';

// SCRUM — pre-fix, the in-chat sidebar/drawer past-session rows had no
// onClick handler. Clicking them did nothing. Now Chat receives onOpenSession
// from Shell and both rail and drawer rows call it.
test.describe('Open a session from inside Chat', () => {
  test('clicking a past-session row in the drawer opens that session', async ({ page }) => {
    const OTHER_ID = 'sess-other-001';
    await loginAs(page);
    await mockSessionsList(page, [
      {
        id: OTHER_ID,
        title: 'A Prior Conversation',
        when: '2 days ago',
        turnCount: 4,
        group: 'This week',
      },
    ]);
    await mockSessionDetail(page, OTHER_ID, {
      title: 'A Prior Conversation',
      turns: [
        {
          userMessage: 'what did we talk about',
          responseText: 'leadership integrity',
        },
      ],
    });

    // Navigate into chat with a fresh session.
    await page.waitForSelector('input.hm-compose-input', { timeout: 8000 });
    await page.locator('button.hm-compose-arrow').click();
    await page.waitForSelector('textarea.ch-input', { timeout: 5000 });

    // Open the drawer and click the past row.
    await page.locator('button.ch-menu').click();
    const drawerRow = page.locator('button.ch-drawer-row', { hasText: 'A Prior Conversation' });
    await expect(drawerRow).toBeVisible({ timeout: 5000 });
    await drawerRow.click();

    // Transcript from that session is now rendered.
    await expect(page.locator('.chat-bubble.user')).toContainText('what did we talk about', {
      timeout: 5000,
    });
  });
});
