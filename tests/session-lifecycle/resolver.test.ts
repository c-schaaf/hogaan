import { describe, expect, it } from 'vitest';
import { SESSION_ARCHIVE_MS, SESSION_IDLE_MS } from '../../src/session-lifecycle/index.js';

describe('session lifecycle constants', () => {
  it('30-min idle threshold matches plan §4B.1', () => {
    expect(SESSION_IDLE_MS).toBe(30 * 60 * 1000);
  });

  it('7-day archive threshold matches plan §4B.1', () => {
    expect(SESSION_ARCHIVE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('archive threshold is strictly greater than idle threshold', () => {
    expect(SESSION_ARCHIVE_MS).toBeGreaterThan(SESSION_IDLE_MS);
  });
});
