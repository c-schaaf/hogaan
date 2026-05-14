import type { Page } from '@playwright/test';

export interface SseChunk {
  type: 'start' | 'delta' | 'end' | 'error';
  sessionId?: string;
  text?: string;
  turnId?: string;
  latencyMs?: number;
  message?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  when: string;
  turnCount: number;
  group: string;
}

/** Mock POST /api/chat/turn/stream to emit deterministic SSE events. */
export async function mockTurnStream(page: Page, textChunks: string[], sessionId = 's-test-1') {
  await page.route('**/api/chat/turn/stream', (route) => {
    const events: SseChunk[] = [
      { type: 'start', sessionId },
      ...textChunks.map((text) => ({ type: 'delta' as const, text })),
      { type: 'end', turnId: 't-test-1', sessionId, latencyMs: 50 },
    ];

    const body = events.map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`).join('');

    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
      body,
    });
  });
}

/** Mock GET /api/sessions to return canned session list. */
export async function mockSessionsList(page: Page, sessions: SessionSummary[] = []) {
  await page.route('**/api/sessions', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions }),
      });
    }
    return route.continue();
  });
}

/** Mock GET /api/sessions/:id to return session detail with turns. */
export async function mockSessionDetail(
  page: Page,
  id: string,
  detail: { title: string; turns: { userMessage: string; responseText: string }[] },
) {
  await page.route(`**/api/sessions/${id}`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: { id, title: detail.title, createdAt: new Date().toISOString() },
        turns: detail.turns.map((t, i) => ({
          id: `turn-${i}`,
          userMessage: t.userMessage,
          responseText: t.responseText,
          createdAt: new Date().toISOString(),
        })),
      }),
    });
  });
}

/** Mock GET + PATCH /api/profile. */
export async function mockProfile(
  page: Page,
  profile: { name: string; email: string; mappedPractices?: string[] },
) {
  await page.route('**/api/profile', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...profile,
        onboardingComplete: true,
        profileFlags: { experienceYears: '5-10' },
      }),
    });
  });
}
