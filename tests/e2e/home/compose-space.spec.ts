import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';

// SCRUM — regression for the Home compose input. The previous implementation
// nested the <input> inside a <button className="hm-compose">, which caused
// the wrapping button's native space-activation (keyup → click) to fire on
// the first space, submitting the message before the user could type a
// second word. JSDOM unit tests couldn't reproduce that — only a real
// browser can — so this lives in e2e.
test.describe('Home compose spacebar', () => {
  test('typing "hello world" preserves the space and does not navigate', async ({ page }) => {
    await loginAs(page);
    await page.waitForSelector('input.hm-compose-input', { timeout: 8000 });
    const input = page.locator('input.hm-compose-input');

    // Focus and type a multi-word string character by character so that any
    // accidental submit fires immediately, not after a bulk .fill().
    await input.focus();
    await page.keyboard.type('hello world');

    await expect(input).toHaveValue('hello world');
    // We must still be on home — no navigation to chat.
    await expect(page.locator('input.hm-compose-input')).toBeVisible();
  });

  test('pressing Enter submits and routes to chat', async ({ page }) => {
    await loginAs(page);
    await page.waitForSelector('input.hm-compose-input', { timeout: 8000 });
    const input = page.locator('input.hm-compose-input');
    await input.fill('a quick question');
    await input.press('Enter');
    await page.waitForSelector('[class*="ch-"]', { timeout: 5000 });
  });
});
