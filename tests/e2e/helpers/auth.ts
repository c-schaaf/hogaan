import type { Page } from '@playwright/test';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_EMAIL = 'test@hogaan.test';
const TEST_NAME = 'Test User';

const FAKE_SESSION = {
  access_token: 'fake-access-token',
  refresh_token: 'fake-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    aud: 'authenticated',
    user_metadata: { full_name: TEST_NAME },
  },
};

const FAKE_ME = {
  id: TEST_USER_ID,
  fullName: TEST_NAME,
  email: TEST_EMAIL,
  onboarded: true,
  mappedPractices: ['Integrity', 'Empathy', 'Peace'],
  commStyle: null,
  responseDepth: null,
};

/**
 * Bypass Supabase auth for E2E tests by:
 * 1. Injecting a fake Supabase session into localStorage before page load
 * 2. Intercepting Supabase auth API calls to return the fake session
 * 3. Intercepting /api/profile to return a fake MeResponse
 */
export async function loginAs(
  page: Page,
  opts: { onboarded?: boolean; practices?: string[] } = {},
) {
  const onboarded = opts.onboarded ?? true;
  const practices = opts.practices ?? FAKE_ME.mappedPractices;

  // Inject fake Supabase session into localStorage before app scripts run.
  // Supabase JS v2 stores the session under `sb-{projectRef}-auth-token` — we
  // monkey-patch getItem so any Supabase auth key returns our fake session.
  await page.addInitScript((session) => {
    const _getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (typeof key === 'string' && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        return JSON.stringify(session);
      }
      return _getItem.call(this, key);
    };
  }, FAKE_SESSION);

  // Intercept Supabase auth API calls (refresh, getUser, etc.)
  await page.route('**/auth/v1/**', (route) => {
    const method = route.request().method();
    if (method === 'GET' || method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FAKE_SESSION),
      });
    }
    return route.continue();
  });

  // Intercept /api/profile
  await page.route('**/api/profile', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...FAKE_ME, onboarded, mappedPractices: practices }),
      });
    }
    return route.continue();
  });

  // Intercept /api/sessions (always needed to avoid 401 on sessions list)
  await page.route('**/api/sessions', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [] }),
      });
    }
    return route.continue();
  });

  await page.goto('/');
}

export { TEST_USER_ID, TEST_EMAIL, TEST_NAME, FAKE_ME };
