import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

// SCRUM — pre-fix, a mid-stream error appended a second bot bubble after the
// partial reply, and the optimistic user bubble silently lived on even though
// the turn never persisted. Now: mid-stream errors replace the partial bubble
// in place; pre-first-byte errors mark the optimistic user bubble as unsent
// and render a "Not sent · Retry" button.
test.describe('Stream error recovery', () => {
  test('a pre-first-byte error marks the user bubble as unsent and offers retry', async ({
    page,
  }) => {
    await loginAs(page);
    await page.route('**/api/chat/turn/stream', (route) => {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        // Emit an error event with no preceding deltas.
        body:
          'event: error\ndata: {"message":"upstream blip"}\n\n' +
          'event: end\ndata: {"turnId":null,"sessionId":null,"latencyMs":10}\n\n',
      });
    });

    await page.waitForSelector('input.hm-compose-input', { timeout: 8000 });
    await page.locator('input.hm-compose-input').fill('a hard prompt');
    await page.locator('button.hm-compose-arrow').click();
    await page.waitForSelector('textarea.ch-input', { timeout: 5000 });

    // Wait for the optimistic user bubble + error UI.
    await expect(page.locator('.chat-bubble.user.is-unsent')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Retry sending message/i })).toBeVisible();
  });

  test('a mid-stream error replaces the partial reply in place (no double bubble)', async ({
    page,
  }) => {
    await loginAs(page);
    await page.route('**/api/chat/turn/stream', (route) => {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body:
          'event: start\ndata: {"sessionId":"s-mid-1"}\n\n' +
          'event: delta\ndata: {"text":"Here\'s a partial "}\n\n' +
          'event: error\ndata: {"message":"connection reset"}\n\n' +
          'event: end\ndata: {"turnId":null,"sessionId":"s-mid-1","latencyMs":50}\n\n',
      });
    });

    await page.waitForSelector('input.hm-compose-input', { timeout: 8000 });
    await page.locator('input.hm-compose-input').fill('keep going');
    await page.locator('button.hm-compose-arrow').click();
    await page.waitForSelector('textarea.ch-input', { timeout: 5000 });

    // Exactly one bot bubble — the partial was replaced, not appended-to.
    await expect(page.locator('.chat-bubble.bot')).toHaveCount(1, { timeout: 5000 });
    // It now shows the warm error copy.
    await expect(page.locator('.chat-bubble.bot')).toContainText(/something went wrong/i);
  });
});
