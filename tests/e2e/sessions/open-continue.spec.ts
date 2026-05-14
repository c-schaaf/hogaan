import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockSessionsList, mockSessionDetail, mockTurnStream } from '../helpers/mock-api';

const SESSION_ID = 'sess-test-001';

test.describe('Open and continue a session', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await mockSessionsList(page, [
      { id: SESSION_ID, title: 'Past Coaching Session', when: '3 days ago', turnCount: 2, group: 'This week' },
    ]);
    await mockSessionDetail(page, SESSION_ID, {
      title: 'Past Coaching Session',
      turns: [
        { userMessage: 'How do I delegate?', responseText: 'Start with small tasks.' },
        { userMessage: 'What about trust?', responseText: 'Trust builds over time.' },
      ],
    });
    await mockTurnStream(page, ['Continuing from here.']);

    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await page.waitForSelector('[class*="ses-"]', { timeout: 8000 });
  });

  test('clicking session row opens chat with prior turns', async ({ page }) => {
    await page.locator('[class*="ses-row"]', { hasText: 'Past Coaching Session' }).click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });

    await expect(page.getByText('How do I delegate?')).toBeVisible();
    await expect(page.getByText('Start with small tasks.')).toBeVisible();
  });

  test('continuing a session sends message with matching sessionId', async ({ page }) => {
    let requestBody: Record<string, unknown> | null = null;
    await page.route('**/api/chat/turn/stream', async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: `event: start\ndata: {"sessionId":"${SESSION_ID}"}\n\nevent: end\ndata: {"turnId":"t1","sessionId":"${SESSION_ID}","latencyMs":50}\n\n`,
      });
    });

    await page.locator('[class*="ses-row"]').first().click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });

    const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input').last();
    await input.fill('Continuing the conversation');
    await input.press('Enter');
    await page.waitForTimeout(500);

    expect(requestBody?.sessionId).toBe(SESSION_ID);
  });
});
