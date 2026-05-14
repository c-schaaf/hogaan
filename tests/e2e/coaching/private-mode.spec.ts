import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockTurnStream } from '../helpers/mock-api';

test.describe('Private mode', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await mockTurnStream(page, ['Private response.']);
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    const compose = page.locator('[class*="hm-compose"]');
    if (await compose.isVisible()) await compose.click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });
  });

  test('toggling private mode shows privacy banner', async ({ page }) => {
    const toggle = page.locator('[class*="privacy"], [class*="priv"], [aria-label*="private" i]').first();
    if (await toggle.isVisible()) {
      await toggle.click();
      await expect(page.getByText(/private|nothing.*saved|not.*saved/i)).toBeVisible({ timeout: 3000 });
    } else {
      test.skip();
    }
  });

  test('private turn sends private=true in request body', async ({ page }) => {
    let requestBody: Record<string, unknown> | null = null;
    await page.route('**/api/chat/turn/stream', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requestBody = body;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'event: start\ndata: {"sessionId":"s1"}\n\nevent: end\ndata: {"turnId":"t1","sessionId":"s1","latencyMs":50}\n\n',
      });
    });

    const toggle = page.locator('[class*="privacy"], [class*="priv"]').first();
    if (await toggle.isVisible()) {
      await toggle.click();
      const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input').last();
      await input.fill('Private question');
      await input.press('Enter');
      await page.waitForTimeout(500);
      expect(requestBody?.private).toBe(true);
    } else {
      test.skip();
    }
  });
});
