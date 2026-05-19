import { expect, test } from '@playwright/test';

test.describe('Onboarding flow', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept auth — no session so app boots to unauthenticated state.
    // We'll set up a signed-in but not-yet-onboarded user.
    await page.addInitScript(() => {
      const _getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (typeof key === 'string' && key.startsWith('sb-') && key.endsWith('-auth-token')) {
          return JSON.stringify({
            access_token: 'fake-token',
            refresh_token: 'fake-refresh',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: { id: 'test-user', email: 'test@test.com', aud: 'authenticated' },
          });
        }
        return _getItem.call(this, key);
      };
    });

    await page.route('**/auth/v1/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake-token',
          user: { id: 'test-user', email: 'test@test.com' },
        }),
      }),
    );

    await page.route('**/api/profile', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'test-user',
            fullName: '',
            email: 'test@test.com',
            onboarded: false,
            mappedPractices: [],
          }),
        });
      }
      return route.fulfill({ status: 200, body: '{"ok":true}' });
    });

    await page.route('**/api/sessions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"sessions":[]}',
      }),
    );

    await page.goto('/');
    await page.waitForSelector('[class*="q-"], input[placeholder*="name" i]', { timeout: 10000 });
  });

  test('step 1 renders name input', async ({ page }) => {
    const nameInput = page.locator('input[type="text"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
  });

  test('entering name and continuing moves to next step', async ({ page }) => {
    const nameInput = page.locator('input[type="text"]').first();
    await nameInput.fill('Hamse');
    await page.keyboard.press('Enter');
    // Should advance — look for years or next question
    await expect(page.locator('[class*="q-"]')).toBeVisible({ timeout: 5000 });
  });

  test('back button is not present on first step', async ({ page }) => {
    const back = page.locator('button[class*="back"], button:has-text("Back")');
    await expect(back).not.toBeVisible();
  });
});
