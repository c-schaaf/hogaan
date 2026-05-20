import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockSessionDetail, mockSessionsList, mockTurnStream } from '../helpers/mock-api';

// SCRUM — refreshing the page mid-conversation used to drop the user into a
// brand new chat (the active sessionId lived only in component memory). Chat
// now writes the active session id to sessionStorage; Shell reads it during
// routeAuthed and re-opens the same transcript.
test.describe('Refresh during chat restores the transcript', () => {
  test('after sending a turn, a hard reload reopens the same session', async ({ page }) => {
    const SESSION_ID = 'sess-restore-001';
    await loginAs(page);
    await mockSessionsList(page, [
      {
        id: SESSION_ID,
        title: 'Restored Session',
        when: 'Just now',
        turnCount: 1,
        group: 'This week',
      },
    ]);
    await mockSessionDetail(page, SESSION_ID, {
      title: 'Restored Session',
      turns: [
        {
          userMessage: 'my first leadership question',
          responseText: 'a thoughtful reply',
        },
      ],
    });
    await mockTurnStream(page, ['a thoughtful reply'], SESSION_ID);

    await page.waitForSelector('input.hm-compose-input', { timeout: 8000 });
    await page.locator('input.hm-compose-input').fill('my first leadership question');
    await page.locator('button.hm-compose-arrow').click();
    await page.waitForSelector('textarea.ch-input', { timeout: 5000 });

    // Wait for the stream end event so sessionId is set + persisted.
    await expect(page.locator('.chat-bubble.bot').first()).toBeVisible({ timeout: 5000 });

    // Sanity: sessionStorage has the active id.
    const stored = await page.evaluate(() => sessionStorage.getItem('hogaan.activeSessionId'));
    expect(stored).toBe(SESSION_ID);

    // Hard reload.
    await page.reload();

    // We land back in chat with the prior turn rendered (from the session
    // detail mock).
    await expect(page.locator('.chat-bubble.user')).toContainText('my first leadership question', {
      timeout: 8000,
    });
  });
});
