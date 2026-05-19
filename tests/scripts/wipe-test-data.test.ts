import { describe, expect, it, vi } from 'vitest';
import { parseArgs, runWipe, type WipeIO } from '../../scripts/wipe-test-data.js';

interface FakeTx {
  delete: ReturnType<typeof vi.fn>;
}

function fakeIo(): WipeIO & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
    lines,
    errors,
  };
}

function fakeDb(rowCount = 0) {
  const deleteSpy = vi.fn().mockResolvedValue(undefined);
  const tx: FakeTx = { delete: deleteSpy };
  return {
    db: {
      select: () => ({
        from: () => Promise.resolve([{ count: rowCount }]),
      }),
      transaction: async (fn: (tx: FakeTx) => Promise<void>): Promise<void> => {
        await fn(tx);
      },
    } as never,
    deleteSpy,
  };
}

describe('parseArgs', () => {
  it('returns confirm=false when flag is absent', () => {
    expect(parseArgs([])).toEqual({ confirm: false, forceNonProd: false });
  });
  it('returns confirm=true when --confirm is present', () => {
    expect(parseArgs(['--confirm'])).toEqual({ confirm: true, forceNonProd: false });
  });
  it('returns forceNonProd=true when --force-non-prod is present', () => {
    expect(parseArgs(['--confirm', '--force-non-prod'])).toEqual({
      confirm: true,
      forceNonProd: true,
    });
  });
});

describe('runWipe — dry-run guard', () => {
  it('emits zero DELETEs when --confirm is absent', async () => {
    const { db, deleteSpy } = fakeDb(7);
    const io = fakeIo();
    const code = await runWipe(
      db,
      { confirm: false, forceNonProd: true, nodeEnv: 'development' },
      io,
    );
    expect(code).toBe(0);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(io.lines.join('\n')).toMatch(/dry-run/);
    expect(io.lines.join('\n')).toMatch(/re-run with --confirm/);
  });
});

describe('runWipe — non-prod guard', () => {
  it('refuses when NODE_ENV !== production and --force-non-prod is absent', async () => {
    const { db, deleteSpy } = fakeDb();
    const io = fakeIo();
    const code = await runWipe(
      db,
      { confirm: true, forceNonProd: false, nodeEnv: 'development' },
      io,
    );
    expect(code).toBe(1);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(io.errors.join('\n')).toMatch(/Refusing to run/);
  });

  it('proceeds when --force-non-prod is supplied on non-prod', async () => {
    const { db, deleteSpy } = fakeDb();
    const io = fakeIo();
    const code = await runWipe(db, { confirm: true, forceNonProd: true, nodeEnv: 'staging' }, io);
    expect(code).toBe(0);
    expect(deleteSpy).toHaveBeenCalled();
  });
});

describe('runWipe — confirm path', () => {
  it('deletes from each table exactly once in FK-respecting order', async () => {
    const { db, deleteSpy } = fakeDb();
    const io = fakeIo();
    const code = await runWipe(
      db,
      { confirm: true, forceNonProd: true, nodeEnv: 'production' },
      io,
    );
    expect(code).toBe(0);
    expect(deleteSpy).toHaveBeenCalledTimes(7);
    const lines = io.lines.join('\n');
    // Order check — the BEFORE table list also fixes the order, but the
    // deleting-… log lines are the actual deletion sequence.
    const seq = [
      'prompt_logs',
      'crisis_events',
      'audit_log',
      'memories',
      'turns',
      'sessions',
      'users',
    ].map((t) => lines.indexOf(`deleting ${t}…`));
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).toBeGreaterThan(seq[i - 1]!);
    }
  });
});
