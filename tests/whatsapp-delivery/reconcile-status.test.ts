import { describe, expect, it } from 'vitest';
import { reconcileStatus } from '../../src/whatsapp-delivery/webhook.js';
import type { Database } from '../../src/shared/db/client.js';

/**
 * Phase 11 R20 — pin reconcileStatus rank-monotonic behavior.
 *
 * The bug we're guarding against: rank comparison must be strict (<= drops,
 * < fires E4 again). Twilio occasionally redelivers `delivered` callbacks
 * for the same MessageSid; if same-rank re-fires the terminal end event we
 * emit duplicate audit + observability rows.
 *
 * Coverage:
 *   - same-rank duplicate is a no-op (the regression target)
 *   - lower-rank out-of-order (sent after delivered) is dropped
 *   - strictly-higher rank applies and emits the right endEvent
 *   - terminal-positive (delivered/read) blocks subsequent terminal-negative
 *     (failed/undelivered) regression
 *   - unknown waMessageId returns applied:false without writing
 */

interface Captured {
  updateCalls: number;
  lastUpdateSet: Record<string, unknown> | null;
  lastUpdateId: string | null;
}

function fakeDb(args: {
  existing: { id: string; currentStatus: string } | undefined;
  capture: Captured;
}): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(args.existing === undefined ? [] : [args.existing]),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          args.capture.updateCalls += 1;
          args.capture.lastUpdateSet = values;
          // We don't have access to the eq() RHS here without deeper drizzle
          // mocking; the test asserts on values + call count.
          args.capture.lastUpdateId = args.existing?.id ?? null;
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as Database;
}

function freshCapture(): Captured {
  return { updateCalls: 0, lastUpdateSet: null, lastUpdateId: null };
}

const baseEvent = {
  kind: 'status' as const,
  waMessageId: 'SMtest-rank',
  timestamp: new Date('2026-05-06T12:00:00Z'),
};

describe('Phase 11 R20 — reconcileStatus rank-monotonic regression', () => {
  it('same-rank duplicate is a no-op (delivered → delivered)', async () => {
    const capture = freshCapture();
    const db = fakeDb({
      existing: { id: 'msg-1', currentStatus: 'delivered' },
      capture,
    });

    const result = await reconcileStatus(db, { ...baseEvent, status: 'delivered' });

    expect(result.applied).toBe(false);
    expect(result.status).toBe('delivered');
    expect(result.endEvent).toBeNull();
    expect(capture.updateCalls).toBe(0);
  });

  it('lower-rank out-of-order is dropped (sent after delivered)', async () => {
    const capture = freshCapture();
    const db = fakeDb({
      existing: { id: 'msg-2', currentStatus: 'delivered' },
      capture,
    });

    const result = await reconcileStatus(db, { ...baseEvent, status: 'sent' });

    expect(result.applied).toBe(false);
    expect(result.status).toBe('delivered');
    expect(result.endEvent).toBeNull();
    expect(capture.updateCalls).toBe(0);
  });

  it('strictly-higher rank applies and emits E4 on delivered', async () => {
    const capture = freshCapture();
    const db = fakeDb({
      existing: { id: 'msg-3', currentStatus: 'sent' },
      capture,
    });

    const result = await reconcileStatus(db, { ...baseEvent, status: 'delivered' });

    expect(result.applied).toBe(true);
    expect(result.status).toBe('delivered');
    expect(result.endEvent).toBe('E4_MessageDeliveredReconciled');
    expect(capture.updateCalls).toBe(1);
    expect(capture.lastUpdateSet).toMatchObject({
      status: 'delivered',
      terminalEndEvent: 'E4_MessageDeliveredReconciled',
    });
  });

  it('strictly-higher rank applies and emits E4 on read', async () => {
    const capture = freshCapture();
    const db = fakeDb({
      existing: { id: 'msg-4', currentStatus: 'delivered' },
      capture,
    });

    const result = await reconcileStatus(db, { ...baseEvent, status: 'read' });

    expect(result.applied).toBe(true);
    expect(result.status).toBe('read');
    expect(result.endEvent).toBe('E4_MessageDeliveredReconciled');
    expect(capture.updateCalls).toBe(1);
  });

  it('failed AFTER delivered is blocked (terminal-positive wins)', async () => {
    const capture = freshCapture();
    const db = fakeDb({
      existing: { id: 'msg-5', currentStatus: 'delivered' },
      capture,
    });

    const result = await reconcileStatus(db, { ...baseEvent, status: 'failed' });

    expect(result.applied).toBe(false);
    expect(result.status).toBe('delivered');
    expect(result.endEvent).toBeNull();
    expect(capture.updateCalls).toBe(0);
  });

  it('undelivered AFTER read is blocked (terminal-positive wins)', async () => {
    const capture = freshCapture();
    const db = fakeDb({
      existing: { id: 'msg-6', currentStatus: 'read' },
      capture,
    });

    const result = await reconcileStatus(db, { ...baseEvent, status: 'undelivered' });

    expect(result.applied).toBe(false);
    expect(result.status).toBe('read');
    expect(result.endEvent).toBeNull();
    expect(capture.updateCalls).toBe(0);
  });

  it('failed AFTER sent applies and maps to E14 (no terminal-positive yet)', async () => {
    const capture = freshCapture();
    const db = fakeDb({
      existing: { id: 'msg-7', currentStatus: 'sent' },
      capture,
    });

    const result = await reconcileStatus(db, { ...baseEvent, status: 'failed' });

    expect(result.applied).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.endEvent).toBe('E14_FailedDeliveryReconciled');
    expect(capture.updateCalls).toBe(1);
    expect(capture.lastUpdateSet).toMatchObject({
      status: 'failed',
      terminalEndEvent: 'E14_FailedDeliveryReconciled',
    });
  });

  it('twilio undelivered maps to DB enum failed', async () => {
    const capture = freshCapture();
    const db = fakeDb({
      existing: { id: 'msg-8', currentStatus: 'queued' },
      capture,
    });

    const result = await reconcileStatus(db, { ...baseEvent, status: 'undelivered' });

    expect(result.applied).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.endEvent).toBe('E14_FailedDeliveryReconciled');
    expect(capture.lastUpdateSet).toMatchObject({ status: 'failed' });
  });

  it('unknown waMessageId returns applied:false without writing', async () => {
    const capture = freshCapture();
    const db = fakeDb({ existing: undefined, capture });

    const result = await reconcileStatus(db, { ...baseEvent, status: 'delivered' });

    expect(result.applied).toBe(false);
    expect(result.endEvent).toBeNull();
    expect(capture.updateCalls).toBe(0);
  });
});
