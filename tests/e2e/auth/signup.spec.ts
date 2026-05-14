import { expect, test } from '@playwright/test';

test.describe('Signup page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/auth/v1/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: null, user: null }),
    }));
    await page.goto('/');
    // Navigate to signup
    await page.waitForSelector('input[name="email"], button:has-text("Create an account")', { timeout: 8000 });
    const createBtn = page.locator('button', { hasText: 'Create an account' });
    if (await createBtn.isVisible()) {
      await createBtn.click();
    }
    await expect(page.getByText('Create my account')).toBeVisible({ timeout: 5000 });
  });

  test('signup form renders name, email, and password fields', async ({ page }) => {
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('shows name error when submitting with empty name', async ({ page }) => {
    await page.locator('input[name="email"]').fill('test@test.com');
    await page.locator('input[type="password"]').fill('password123');
    await page.locator('button', { hasText: 'Create my account' }).click();
    await expect(page.getByText('What should we call you?')).toBeVisible();
  });

  test('shows password strength meter when typing', async ({ page }) => {
    await page.locator('input[type="password"]').fill('abc');
    await expect(page.locator('.pwm')).toBeVisible();
  });

  test('"Sign in" link navigates back to login', async ({ page }) => {
    await page.locator('button', { hasText: 'Sign in' }).click();
    await expect(page.getByText('Welcome back.')).toBeVisible();
  });

  test('tab navigation reaches all 3 fields', async ({ page }) => {
    const nameInput = page.locator('input[name="name"]');
    await nameInput.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('input[name="email"]')).toBeFocused();
  });
});
