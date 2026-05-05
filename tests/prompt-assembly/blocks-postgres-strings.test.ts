import { describe, expect, it } from 'vitest';
import { buildMemoryBlock, buildSessionContext } from '../../src/prompt-assembly/blocks.js';

/**
 * Regression test for the 2026-05-05 P0 production incident.
 *
 * postgres-js returns timestamp columns as ISO strings, NOT Date objects.
 * Drizzle types those columns as `Date`, but the runtime values are
 * strings. Anywhere we call a Date method (.getTime, .toISOString, etc.)
 * directly on a value sourced from a DB row, we crash:
 *
 *   TypeError: m.createdAt.toISOString is not a function
 *
 * The bug manifested in production because the synthetic Phase 7
 * verification harness fed Date instances directly into buildMemoryBlock,
 * never exercising the string path. As soon as a real coaching turn ran
 * with at least one memory hit, the entire pipeline crashed silently
 * (webhook acked 204, no response sent).
 *
 * These tests force the string path by passing ISO strings cast through
 * `as unknown as Date` — exactly what arrives at runtime today. They MUST
 * pass without throwing. If they ever fail again, the production
 * pipeline is broken in the same way.
 */

// Simulate a postgres-js row: typed as Date but actually an ISO string at runtime.
function pgDate(iso: string): Date {
  return iso as unknown as Date;
}

describe('buildMemoryBlock: postgres-js string-typed timestamps (regression P0 2026-05-05)', () => {
  it('does not throw when createdAt is an ISO string instead of Date', () => {
    expect(() =>
      buildMemoryBlock([
        {
          content: 'memory one',
          createdAt: pgDate('2026-04-15T10:00:00.000Z'),
        },
        {
          content: 'memory two',
          createdAt: pgDate('2026-05-01T08:30:00.000Z'),
        },
      ]),
    ).not.toThrow();
  });

  it('renders the correct ISO date prefix from string-typed createdAt', () => {
    const block = buildMemoryBlock([
      {
        content: 'a memory entry',
        createdAt: pgDate('2026-04-15T10:00:00.000Z'),
      },
    ]);
    expect(block).toContain('(2026-04-15)');
    expect(block).toContain('a memory entry');
  });

  it('sorts memories most-recent-first when createdAt values are ISO strings', () => {
    const block = buildMemoryBlock([
      { content: 'older entry', createdAt: pgDate('2026-04-01T10:00:00.000Z') },
      { content: 'newer entry', createdAt: pgDate('2026-05-01T10:00:00.000Z') },
      { content: 'middle entry', createdAt: pgDate('2026-04-15T10:00:00.000Z') },
    ]);
    const lines = block.split('\n');
    // Header on lines[0], then memory lines most-recent-first.
    expect(lines[1]).toContain('newer entry');
    expect(lines[2]).toContain('middle entry');
    expect(lines[3]).toContain('older entry');
  });

  it('handles a mix of Date instances and ISO strings (drizzle may coerce some, postgres-js others)', () => {
    expect(() =>
      buildMemoryBlock([
        { content: 'string ts', createdAt: pgDate('2026-04-15T10:00:00.000Z') },
        { content: 'date ts', createdAt: new Date('2026-05-01T10:00:00.000Z') },
      ]),
    ).not.toThrow();
  });

  it('still returns the empty-state placeholder for an empty memory list', () => {
    expect(buildMemoryBlock([])).toBe('## Memory\n(no prior memories retrieved)');
  });
});

describe('buildSessionContext: postgres-js string-typed timestamps', () => {
  // buildSessionContext only reads userMessage + responseText today, but the
  // shape of `sessionTurns` is also DB-sourced so a future change that adds
  // a Date field would have the same risk. Lock the basic case in.
  it('does not throw when called with sessionTurns originating from postgres-js', () => {
    expect(() =>
      buildSessionContext([
        { userMessage: 'hello', responseText: 'hi back' },
        { userMessage: 'follow up', responseText: null },
      ]),
    ).not.toThrow();
  });
});
