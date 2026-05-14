import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Streaming response', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    const compose = page.locator('[class*="hm-compose"]');
    if (await compose.isVisible()) await compose.click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });
  });

  test('final streamed text renders correctly', async ({ page }) => {
    await page.route('**/api/chat/turn/stream', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: [
          'event: start\ndata: {"sessionId":"s1"}\n\n',
          'event: delta\ndata: {"text":"Hello "}\n\n',
          'event: delta\ndata: {"text":"there."}\n\n',
          'event: end\ndata: {"turnId":"t1","sessionId":"s1","latencyMs":50}\n\n',
        ].join(''),
      }),
    );

    const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input').last();
    await input.fill('test');
    await input.press('Enter');

    await expect(page.getByText('Hello there.')).toBeVisible({ timeout: 8000 });
  });

  test('input is re-enabled after stream ends', async ({ page }) => {
    await page.route('**/api/chat/turn/stream', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'event: start\ndata: {"sessionId":"s1"}\n\nevent: delta\ndata: {"text":"Done"}\n\nevent: end\ndata: {"turnId":"t1","sessionId":"s1","latencyMs":50}\n\n',
      }),
    );

    const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input').last();
    await input.fill('test');
    await input.press('Enter');

    await expect(page.getByText('Done')).toBeVisible({ timeout: 8000 });
    await expect(input).toBeEnabled({ timeout: 3000 });
  });
});
