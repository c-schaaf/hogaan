import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeInboundMessage } from '../../src/coaching/webhook-router.js';
import { hashPhone } from '../../src/shared/db/encryption.js';
import { asUserId } from '../../src/shared/types/index.js';
import type { Database, SqlClient } from '../../src/shared/db/client.js';
import type { RedisBundle } from '../../src/shared/redis/client.js';
import type { RateLimiters } from '../../src/shared/redis/rate-limit.js';
import type { TraceEmitter } from '../../src/shared/trace/index.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * Phase 12 R17 — STOP keyword fires at webhook-router scope, regardless
 * of user state (onboarded, mid-onboarding, mid-scenario).
 *
 * Mocks identity, opt-out persistence, sendOutbound. Asserts:
 *   - onboarded user sending "STOP" triggers recordOptOut + confirmation
 *     send + RouteOutcome.kind='opted_out'
 *   - non-opt-out message routes through normally
 */

vi.mock('../../src/identity/index.js', () => ({
  resolveIdentity: vi.fn(),
}));

vi.mock('../../src/onboarding/opt-out.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/onboarding/opt-out.js')>(
    '../../src/onboarding/opt-out.js',
  );
  return {
    ...actual,
    recordOptOut: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../../src/whatsapp-delivery/orchestrator.js', () => ({
  sendOutbound: vi.fn(() =>
    Promise.resolve({
      endEvent: 'E1_MessageDispatched',
      waMessageId: 'SMtest-optout',
      dispatchPath: 'direct',
      retryCount: 0,
      queueLoops: 0,
    }),
  ),
}));

vi.mock('../../src/coaching/orchestrator.js', () => ({
  runCoachingTurn: vi.fn(() => Promise.resolve({ kind: 'should-not-be-called' })),
}));

vi.mock('../../src/onboarding/index.js', () => ({
  handleOnboardingMessage: vi.fn(() => Promise.resolve({ kind: 'should-not-be-called' })),
}));

const TEST_USER_ID = asUserId('00000000-0000-0000-0000-00000000abcd');
const TEST_PHONE = '+254700099991';

function fakeDb(): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    insert: () => ({
      values: () => Promise.resolve(),
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
  } as unknown as Database;
}

function fakeRedis(): RedisBundle {
  return {
    client: {} as never,
    withTimeout: <T>(_op: string, _ms: number, fn: () => Promise<T>) => fn(),
  } as RedisBundle;
}

function makeDeps(): {
  config: AppConfig;
  db: Database;
  sql: SqlClient;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
  traceEmitter: TraceEmitter;
} {
  return {
    config: { logLevel: 'error' } as AppConfig,
    db: fakeDb(),
    sql: {} as unknown as SqlClient,
    redis: fakeRedis(),
    rateLimiters: {} as unknown as RateLimiters,
    traceEmitter: { emit: () => undefined, flush: () => Promise.resolve() } as TraceEmitter,
  };
}

beforeEach(async () => {
  const idMod = await import('../../src/identity/index.js');
  vi.mocked(idMod.resolveIdentity).mockReset();
  vi.mocked(idMod.resolveIdentity).mockResolvedValue({
    endEvent: 'E1_ExistingUserAuthenticated',
    userId: TEST_USER_ID,
    status: 'onboarded',
    isNew: false,
    isResumed: false,
    lastCompletedStep: 0,
  });
  const oo = await import('../../src/onboarding/opt-out.js');
  vi.mocked(oo.recordOptOut).mockClear();
  const wpp = await import('../../src/whatsapp-delivery/orchestrator.js');
  vi.mocked(wpp.sendOutbound).mockClear();
  const coach = await import('../../src/coaching/orchestrator.js');
  vi.mocked(coach.runCoachingTurn).mockClear();
});

describe('Phase 12 R17 — global STOP keyword at webhook router', () => {
  it('onboarded user sending STOP triggers opt-out + confirmation', async () => {
    const oo = await import('../../src/onboarding/opt-out.js');
    const wpp = await import('../../src/whatsapp-delivery/orchestrator.js');
    const coach = await import('../../src/coaching/orchestrator.js');

    const result = await routeInboundMessage(makeDeps(), {
      fromE164: TEST_PHONE,
      body: 'STOP',
      mediaUrls: [],
      inboundMessageSid: 'SMtest-stop-001',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
      traceId: 'trace-r17-001',
    });

    expect(result.kind).toBe('opted_out');
    if (result.kind === 'opted_out') {
      expect(result.reason).toBe('global stop keyword');
    }

    expect(oo.recordOptOut).toHaveBeenCalledTimes(1);
    expect(oo.recordOptOut).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      TEST_USER_ID,
      hashPhone(TEST_PHONE),
    );
    expect(wpp.sendOutbound).toHaveBeenCalledTimes(1);
    const sendArgs = vi.mocked(wpp.sendOutbound).mock.calls[0]![1] as { body: string };
    expect(sendArgs.body).toMatch(/opted out/i);
    // Crucially: coaching pipeline NEVER runs.
    expect(coach.runCoachingTurn).not.toHaveBeenCalled();
  });

  it('non-opt-out message routes through to coaching', async () => {
    const oo = await import('../../src/onboarding/opt-out.js');
    const coach = await import('../../src/coaching/orchestrator.js');
    vi.mocked(coach.runCoachingTurn).mockResolvedValueOnce({
      endEvent: 'E1_TurnCompleted',
      responseText: 'response',
      practiceTag: 'integrity',
      levelTag: 'self',
      latencyMs: 100,
      sessionId: 'session' as never,
      turnId: null,
      traceId: 'trace',
    });

    const result = await routeInboundMessage(makeDeps(), {
      fromE164: TEST_PHONE,
      body: 'I have a question about leadership',
      mediaUrls: [],
      inboundMessageSid: 'SMtest-normal-001',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
      traceId: 'trace-r17-002',
    });

    expect(result.kind).toBe('coaching');
    expect(oo.recordOptOut).not.toHaveBeenCalled();
    expect(coach.runCoachingTurn).toHaveBeenCalledTimes(1);
  });

  it('STOP fires even for users still in onboarding', async () => {
    const idMod = await import('../../src/identity/index.js');
    vi.mocked(idMod.resolveIdentity).mockResolvedValueOnce({
      endEvent: 'E3_ResumeOnboardingDetected',
      userId: TEST_USER_ID,
      status: 'onboarding_started',
      isNew: false,
      isResumed: true,
      lastCompletedStep: 2,
    });
    const oo = await import('../../src/onboarding/opt-out.js');
    const onb = await import('../../src/onboarding/index.js');

    const result = await routeInboundMessage(makeDeps(), {
      fromE164: TEST_PHONE,
      body: 'STOP',
      mediaUrls: [],
      inboundMessageSid: 'SMtest-stop-onb',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
      traceId: 'trace-r17-003',
    });

    expect(result.kind).toBe('opted_out');
    expect(oo.recordOptOut).toHaveBeenCalledTimes(1);
    // Onboarding pipeline NEVER runs.
    expect(onb.handleOnboardingMessage).not.toHaveBeenCalled();
  });
});
