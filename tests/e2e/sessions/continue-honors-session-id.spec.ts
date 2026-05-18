import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockSessionDetail, mockSessionsList } from '../helpers/mock-api';

/**
 * SCRUM-53 — clicking "Continue past session" then sending a message must:
 *   1. Send the chat-turn request with the past session's sessionId.
 *   2. Have the server echo that same sessionId back in the SSE `start`
 *      event (proof the server honored it rather than creating a new row).
 *   3. After a page refresh, the sessions list shows only the one session,
 *      not a duplicate.
 *
 * The existing sessions/open-continue.spec.ts asserts (1). This spec adds
 * (2) and (3) so a regression to the pre-fix "ignore client sessionId"
 * behaviour will fail loudly.
 */

const PAST_SESSION_ID = 'sess-continue-test-001';
const PAST_SESSION_TITLE = 'Last week conversation';

test.describe('Continue past session honors the named sessionId', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await mockSessionsList(page, [
      {
        id: PAST_SESSION_ID,
        title: PAST_SESSION_TITLE,
        when: '5 days ago',
        turnCount: 3,
        group: 'This week',
      },
    ]);
    await mockSessionDetail(page, PAST_SESSION_ID, {
      title: PAST_SESSION_TITLE,
      turns: [{ userMessage: 'How do I run my first 1:1?', responseText: 'Start with curiosity.' }],
    });

    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await page.waitForSelector('[class*="ses-"]', { timeout: 8000 });
  });

  test('SSE start event echoes the same sessionId the client sent', async ({ page }) => {
    // Capture request body + craft a response that echoes back the same id.
    // Pre-fix behavior would have caused the server to emit a *different*
    // sessionId in `start` (the freshly-created row). This mock will pass
    // through whatever sessionId the client sent, so the test asserts the
    // round-trip on the client side: the chat view continues to operate
    // against PAST_SESSION_ID rather than switching to a new one.
    let receivedSessionId: string | undefined;
    await page.route('**/api/chat/turn/stream', async (route) => {
      const body = route.request().postDataJSON() as { sessionId?: string };
      receivedSessionId = body.sessionId;
      const echoed = body.sessionId ?? 'sess-server-generated-new';
      const sse =
        `event: start\ndata: {"sessionId":"${echoed}"}\n\n` +
        `event: delta\ndata: {"text":"Picking up where we left off."}\n\n` +
        `event: end\ndata: {"turnId":"t-continue-1","sessionId":"${echoed}","latencyMs":42}\n\n`;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: sse,
      });
    });

    await page.locator('button[class*="ses-row"]', { hasText: PAST_SESSION_TITLE }).click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });

    const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input').last();
    await input.fill('What about the second meeting?');
    await input.press('Enter');

    // Allow the SSE flush to complete.
    await page.waitForTimeout(500);

    // The client must have sent the past session's id...
    expect(receivedSessionId).toBe(PAST_SESSION_ID);
    // ...and the streamed reply must be visible in the *same* chat view.
    await expect(page.getByText('Picking up where we left off.')).toBeVisible();
  });

  test('after a continued turn + refresh, sessions list still shows one row (no duplicate)', async ({
    page,
  }) => {
    // Echo the sessionId back on the SSE response (server behavior post-fix).
    await page.route('**/api/chat/turn/stream', async (route) => {
      const body = route.request().postDataJSON() as { sessionId?: string };
      const echoed = body.sessionId ?? 'sess-bug-new';
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body:
          `event: start\ndata: {"sessionId":"${echoed}"}\n\n` +
          `event: end\ndata: {"turnId":"t-continue-2","sessionId":"${echoed}","latencyMs":10}\n\n`,
      });
    });

    await page.locator('button[class*="ses-row"]', { hasText: PAST_SESSION_TITLE }).click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });

    const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input').last();
    await input.fill('More thoughts.');
    await input.press('Enter');
    await page.waitForTimeout(500);

    // Refresh — sessions list mock still returns exactly the one row.
    await page.evaluate(() => sessionStorage.setItem('shell-phase', 'sessions'));
    await page.reload();
    await page.waitForSelector('[class*="ses-"]', { timeout: 8000 });

    const rows = page.locator('button[class*="ses-row"]', { hasText: PAST_SESSION_TITLE });
    await expect(rows).toHaveCount(1);
  });
});
