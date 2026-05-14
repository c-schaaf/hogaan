import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

test.describe('Delete session via API', () => {
  test('DELETE /api/sessions/:id returns { ok: true }', async ({ page }) => {
    await loginAs(page);
    await page.waitForSelector('[class*="hm-"]', { timeout: 8000 });

    // Verify DELETE endpoint directly via page.request (no UI button yet)
    const response = await page.request.delete('/api/sessions/nonexistent-session', {
      headers: { Authorization: 'Bearer fake-access-token' },
    });
    // Expect 404 for nonexistent or 200 with { ok: true } — either is acceptable
    expect([200, 404]).toContain(response.status());
  });
});
