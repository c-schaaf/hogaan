import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockTurnStream } from '../helpers/mock-api';

// SCRUM — the chat composer was a single-line <input> with no shiftKey guard,
// so Shift+Enter submitted instead of inserting a newline. It also lacked an
// isComposing guard, so IME Enter submitted half-composed text. The composer
// is now a <textarea> with both guards.
test.describe('Chat composer key handling', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await mockTurnStream(page, ['Reply.']);
    await page.waitForSelector('input.hm-compose-input', { timeout: 8000 });
    // Use the compose arrow to navigate to the chat phase deterministically.
    await page.locator('button.hm-compose-arrow').click();
    await page.waitForSelector('textarea.ch-input', { timeout: 5000 });
  });

  test('the composer is a <textarea>, not an <input>', async ({ page }) => {
    await expect(page.locator('textarea.ch-input')).toBeVisible();
  });

  test('Shift+Enter inserts a newline and does NOT submit', async ({ page }) => {
    const ta = page.locator('textarea.ch-input');
    await ta.focus();
    await page.keyboard.type('line one');
    await ta.press('Shift+Enter');
    await page.keyboard.type('line two');

    await expect(ta).toHaveValue('line one\nline two');
    // The user message should NOT have been sent yet (no user bubble).
    await expect(page.getByText('line one', { exact: false })).toHaveCount(1); // only inside textarea
  });

  test('plain Enter submits', async ({ page }) => {
    const ta = page.locator('textarea.ch-input');
    await ta.fill('a single-line message');
    await ta.press('Enter');
    // A user bubble appears with the text.
    await expect(page.locator('.chat-bubble.user').getByText('a single-line message')).toBeVisible({
      timeout: 5000,
    });
  });

  test('Enter during IME composition does NOT submit', async ({ page }) => {
    const ta = page.locator('textarea.ch-input');
    await ta.focus();
    // Simulate an IME-style Enter by dispatching keydown with isComposing=true.
    // Playwright's keyboard.press doesn't model composition, so we go via
    // page.evaluate against the focused element.
    await ta.evaluate((el) => {
      const ev = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(ev, 'isComposing', { value: true });
      (el as HTMLTextAreaElement).dispatchEvent(ev);
    });
    // No user bubble should have been created.
    await expect(page.locator('.chat-bubble.user')).toHaveCount(0);
  });
});
