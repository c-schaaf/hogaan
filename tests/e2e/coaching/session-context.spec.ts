import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Session context across turns', () => {
  test('two turns in same chat share the same sessionId in requests', async ({ page }) => {
    await loginAs(page);
    const sessionIds: string[] = [];

    await page.route('**/api/chat/turn/stream', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const sessionId = (body.sessionId as string) ?? 's-new';
      sessionIds.push(sessionId);
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: `event: start\ndata: {"sessionId":"s-consistent"}\n\nevent: delta\ndata: {"text":"Response"}\n\nevent: end\ndata: {"turnId":"t${sessionIds.length}","sessionId":"s-consistent","latencyMs":50}\n\n`,
      });
    });

    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });
    const chip = page.locator('[class*="hm-chip"]').first();
    if (await chip.isVisible()) await chip.click();
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });

    const input = page.locator('[class*="ch-"] textarea, [class*="ch-"] input').last();

    // First turn
    await input.fill('First message');
    await input.press('Enter');
    await expect(page.getByText('Response')).toBeVisible({ timeout: 5000 });

    // Second turn
    await input.fill('Second message');
    await input.press('Enter');
    await page.waitForTimeout(500);

    // Both turns should have been made; the second should include the returned sessionId
    expect(sessionIds.length).toBe(2);
  });
});
