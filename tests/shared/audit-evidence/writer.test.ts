import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(() => Promise.resolve(undefined)),
  mkdir: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

const { writeFile, mkdir } = await import('node:fs/promises');
const { existsSync } = await import('node:fs');
const { recordEvidence, _internal } = await import(
  '../../../src/shared/audit-evidence/writer.js'
);

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const PHASE_10_DIR = path.join(REPO_ROOT, 'audit-evidence', 'phase-10');
const PHASE_12_DIR = path.join(REPO_ROOT, 'audit-evidence', 'phase-12');

describe('audit-evidence/writer slug()', () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    {
      name: 'replaces slashes, question marks, and bangs with dashes',
      input: 'control with / and ? chars!',
      expected: 'control-with-and-chars',
    },
    {
      name: 'lowercases mixed case',
      input: 'MixedCASEInput',
      expected: 'mixedcaseinput',
    },
    {
      name: 'collapses runs of non-alphanumerics into a single dash',
      input: 'a___b   c!!!d',
      expected: 'a-b-c-d',
    },
    {
      name: 'strips leading and trailing dashes',
      input: '---hello---world---',
      expected: 'hello-world',
    },
    {
      name: 'truncates strings longer than 80 chars',
      input: 'a'.repeat(120),
      expected: 'a'.repeat(80),
    },
    {
      name: 'truncates after slugification, preserving 80 chars',
      input: `${'control/'.repeat(20)}tail`,
      expected: 'control-'.repeat(10).slice(0, 80),
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(_internal.slug(c.input)).toBe(c.expected);
    });
  }
});

describe('audit-evidence/writer recordEvidence()', () => {
  beforeEach(() => {
    vi.mocked(writeFile).mockClear();
    vi.mocked(mkdir).mockClear();
    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T15:30:45.123Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes a JSON object with recordedAt pinned to the current ISO time', async () => {
    await recordEvidence({
      testId: 'sample-test/case-01',
      controlId: 'T3.Sample.Case',
      tier: 'T3',
      outcome: 'pass',
      description: 'sample description',
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    const call = vi.mocked(writeFile).mock.calls[0];
    expect(call).toBeDefined();
    const [, contents, encoding] = call!;
    expect(encoding).toBe('utf8');
    expect(typeof contents).toBe('string');
    const parsed = JSON.parse((contents as string).trimEnd()) as Record<string, unknown>;
    expect(parsed['recordedAt']).toBe('2026-06-02T15:30:45.123Z');
    expect(parsed['testId']).toBe('sample-test/case-01');
    expect(parsed['controlId']).toBe('T3.Sample.Case');
    expect(parsed['tier']).toBe('T3');
    expect(parsed['outcome']).toBe('pass');
    expect(parsed['description']).toBe('sample description');
    expect(parsed['phase']).toBe('phase-10');
    expect('details' in parsed).toBe(false);
    expect('artifactHash' in parsed).toBe(false);
  });

  it('routes phase-12 testIds to the phase-12 evidence directory', async () => {
    await recordEvidence({
      testId: 'phase-12/voice-fidelity/sample-01',
      controlId: 'T5.Voice.Sample',
      tier: 'T5',
      outcome: 'pass',
      description: 'phase-12 routing',
      phase: 'phase-12',
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    const call = vi.mocked(writeFile).mock.calls[0];
    expect(call).toBeDefined();
    const [filepath] = call!;
    const expectedFilename = `2026-06-02-${_internal.slug('phase-12/voice-fidelity/sample-01')}.json`;
    expect(filepath).toBe(path.join(PHASE_12_DIR, expectedFilename));

    const parsed = JSON.parse((call![1] as string).trimEnd()) as Record<string, unknown>;
    expect(parsed['phase']).toBe('phase-12');
  });

  it('defaults to phase-10 directory when phase is omitted', async () => {
    await recordEvidence({
      testId: 'plain-test/case-02',
      controlId: 'T1.Plain.Case',
      tier: 'T1',
      outcome: 'pass',
      description: 'phase-10 default routing',
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    const call = vi.mocked(writeFile).mock.calls[0];
    expect(call).toBeDefined();
    const [filepath] = call!;
    const expectedFilename = `2026-06-02-${_internal.slug('plain-test/case-02')}.json`;
    expect(filepath).toBe(path.join(PHASE_10_DIR, expectedFilename));
  });

  it('fails open and writes to stderr when writeFile rejects with EACCES', async () => {
    const eaccesError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.mocked(writeFile).mockRejectedValueOnce(eaccesError);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      recordEvidence({
        testId: 'fail-open/case-03',
        controlId: 'T1.Plain.Case',
        tier: 'T1',
        outcome: 'pass',
        description: 'fail-open contract',
      }),
    ).resolves.toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const arg = stderrSpy.mock.calls[0]?.[0];
    expect(typeof arg).toBe('string');
    expect(String(arg)).toContain('[audit-evidence] failed to write');
    expect(String(arg)).toContain('permission denied');

    stderrSpy.mockRestore();
  });

  it('creates the target directory when existsSync reports it missing', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);

    await recordEvidence({
      testId: 'mkdir-test/case-04',
      controlId: 'T1.Plain.Case',
      tier: 'T1',
      outcome: 'pass',
      description: 'directory bootstrap',
    });

    expect(mkdir).toHaveBeenCalledTimes(1);
    const mkdirCall = vi.mocked(mkdir).mock.calls[0];
    expect(mkdirCall).toBeDefined();
    expect(mkdirCall![0]).toBe(PHASE_10_DIR);
    expect(mkdirCall![1]).toEqual({ recursive: true });
  });
});
