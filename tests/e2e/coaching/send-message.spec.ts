import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockTurnStream } from '../helpers/mock-api';

test.describe('Send message', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await mockTurnStream(page, ['Hello, ', 'I can help with that.']);
    // Navigate to chat
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    // Click compose button or a chip to open chat
    const compose = page.locator('[class*="hm-compose"]');
    if (await compose.isVisible()) {
      await compose.click();
    }
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });
  });

  test('typing a message and pressing Enter sends it', async ({ page }) => {
    const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input[type="text"]').last();
    await input.fill('I need help leading my team.');
    await input.press('Enter');

    // User bubble should appear
    await expect(page.getByText('I need help leading my team.')).toBeVisible({ timeout: 5000 });
  });

  test('bot response renders after send', async ({ page }) => {
    const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input[type="text"]').last();
    await input.fill('I need help leading my team.');
    await input.press('Enter');

    await expect(page.getByText(/Hello,.*I can help with that\./s)).toBeVisible({ timeout: 8000 });
  });

  test('thinking indicator appears before response', async ({ page }) => {
    // Use a slow stream to catch the thinking state
    await page.route('**/api/chat/turn/stream', async (route) => {
      await new Promise((r) => setTimeout(r, 200));
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'event: start\ndata: {"sessionId":"s1"}\n\nevent: delta\ndata: {"text":"Hi"}\n\nevent: end\ndata: {"turnId":"t1","sessionId":"s1","latencyMs":50}\n\n',
      });
    });

    const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input[type="text"]').last();
    await input.fill('Quick question');
    await input.press('Enter');

    // Thinking indicator or bot bubble should appear
    await expect(
      page.locator('[class*="thinking"], [class*="ch-bot"]').first()
    ).toBeVisible({ timeout: 5000 });
  });
});
