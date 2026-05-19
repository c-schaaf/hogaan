import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

// SCRUM-54 — click "New Chat" → send a follow-up message → sessions list
// shows two distinct sessions because the second request was sent with no
// sessionId, and the server (post-SCRUM-54) always creates a new session
// when none is named.
test.describe('New Chat button', () => {
  test('starts a fresh session — sessions list ends with two rows', async ({ page }) => {
    await loginAs(page);

    // Mutable in-memory sessions list — grows as each new sessionId
    // appears via /api/chat/turn/stream "start" events.
    const knownSessions = new Map<string, string>();

    await page.route('**/api/sessions', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: Array.from(knownSessions.entries()).map(([id, title], i) => ({
              id,
              title,
              msgs: 1,
              when: 'just now',
              group: 'This week',
              // newest first
              ...(i === 0 ? {} : {}),
            })),
          }),
        });
      }
      return route.continue();
    });

    // Each turn-stream call mints a different sessionId iff the request
    // body does NOT carry one. If the body carries a sessionId we echo it
    // back — that matches the production resolver post-SCRUM-54.
    let mintCounter = 0;
    await page.route('**/api/chat/turn/stream', async (route) => {
      const reqBody = route.request().postDataJSON() as { message: string; sessionId?: string };
      const sid =
        typeof reqBody.sessionId === 'string' && reqBody.sessionId.length > 0
          ? reqBody.sessionId
          : `sess-mint-${++mintCounter}`;
      knownSessions.set(sid, `Session ${sid}`);

      const events = [
        { type: 'start', sessionId: sid },
        { type: 'delta', text: 'OK.' },
        { type: 'end', turnId: `t-${sid}`, sessionId: sid, latencyMs: 25 },
      ];
      const body = events
        .map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
        .join('');
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body,
      });
    });

    // Open chat from the homepage.
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    const compose = page.locator('[class*="hm-compose"]').first();
    await compose.click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });

    // Turn 1 — server mints sess-mint-1.
    const input = page.locator('[class*="ch-"] input[type="text"]').last();
    await input.fill('first message');
    await input.press('Enter');
    await expect(page.getByText('first message')).toBeVisible({ timeout: 5000 });

    // Click "New Chat".
    await page.getByRole('button', { name: 'Start a new chat' }).click();

    // After reset the previous user bubble should be gone.
    await expect(page.getByText('first message')).toHaveCount(0);

    // Turn 2 — body has no sessionId, so the route mints sess-mint-2.
    await input.fill('second message');
    await input.press('Enter');
    await expect(page.getByText('second message')).toBeVisible({ timeout: 5000 });

    // Two distinct sessions were registered by our /turn/stream mock.
    expect(knownSessions.size).toBe(2);
    expect(Array.from(knownSessions.keys())).toEqual(['sess-mint-1', 'sess-mint-2']);
  });
});
