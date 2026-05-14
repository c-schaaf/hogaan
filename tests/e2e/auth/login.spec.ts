import { expect, test } from '@playwright/test';

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept Supabase auth so page loads without real credentials
    await page.route('**/auth/v1/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: null, user: null }),
    }));
    await page.goto('/');
    // Wait for app to boot to unauthenticated state → login screen
    await page.waitForSelector('[data-testid="phase-login"], input[name="email"]', { timeout: 10000 });
  });

  test('login form renders email and password fields', async ({ page }) => {
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('shows email validation error on empty submit', async ({ page }) => {
    await page.locator('button', { hasText: 'Sign in' }).click();
    await expect(page.getByText("That email doesn't look right.")).toBeVisible();
  });

  test('shows error banner for wrong credentials', async ({ page }) => {
    await page.route('**/auth/v1/token**', (route) => route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }),
    }));

    await page.locator('input[name="email"]').fill('user@test.com');
    await page.locator('input[type="password"]').fill('wrongpassword');
    await page.locator('button', { hasText: 'Sign in' }).click();

    await expect(page.getByText(/Email or password didn't match/)).toBeVisible({ timeout: 5000 });
  });

  test('"Create an account" link navigates to signup', async ({ page }) => {
    await page.locator('button', { hasText: 'Create an account' }).click();
    await expect(page.getByText('Create my account')).toBeVisible();
  });

  test('"Forgot your password?" navigates to forgot page', async ({ page }) => {
    await page.locator('button', { hasText: 'Forgot your password?' }).click();
    await expect(page.getByText(/send.*reset|reset.*link/i)).toBeVisible({ timeout: 5000 });
  });
});
