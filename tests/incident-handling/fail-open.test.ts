import { describe, expect, it } from 'vitest';
import { runFailOpen } from '../../src/incident-handling/index.js';

describe('runFailOpen', () => {
  it('returns the wrapped value on success', async () => {
    const r = await runFailOpen(() => Promise.resolve('ok'), 'P1', 'should not fire', {
      source: 'test',
    });
    expect(r).toEqual({ ok: true, value: 'ok' });
  });

  it('does NOT throw and returns ok:false when the inner fn rejects', async () => {
    const r = await runFailOpen(() => Promise.reject(new Error('boom')), 'P2', 'expected failure', {
      source: 'test',
    });
    expect(r).toEqual({ ok: false });
  });

  it('does NOT throw on synchronous throw inside the fn', async () => {
    const r = await runFailOpen(
      () => {
        throw new Error('sync boom');
      },
      'P2',
      'sync failure',
      { source: 'test' },
    );
    expect(r).toEqual({ ok: false });
  });
});
