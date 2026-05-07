import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fastPathTriage, _CRISIS_KEYWORDS } from '../../src/coaching/index.js';
import { TRIAGE_SYSTEM_PROMPT, triage } from '../../src/coaching/triage.js';
import { LlmServiceUnavailableError } from '../../src/shared/llm/errors.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';
import type * as IncidentHandling from '../../src/incident-handling/index.js';

describe('fastPathTriage — synchronous decisions', () => {
  it('flags empty body and no media → empty', () => {
    const r = fastPathTriage('', []);
    expect(r?.status).toBe('empty');
  });

  it('flags media without text → media_only', () => {
    const r = fastPathTriage('', ['https://m.example/a.jpg']);
    expect(r?.status).toBe('media_only');
  });

  it('flags suicide language → crisis', () => {
    const r = fastPathTriage('I want to kill myself', []);
    expect(r?.status).toBe('crisis');
  });

  it('flags abuse language → crisis', () => {
    const r = fastPathTriage('My partner beats me', []);
    expect(r?.status).toBe('crisis');
  });

  it('returns null on benign messages → defers to LLM classifier', () => {
    expect(fastPathTriage('I have a leadership question', [])).toBeNull();
    expect(fastPathTriage('Hi, how do I lead my team?', [])).toBeNull();
  });

  it('crisis keyword catalog has at least 25 entries (red-team coverage)', () => {
    expect(_CRISIS_KEYWORDS.length).toBeGreaterThanOrEqual(25);
  });

  it('case-insensitive — "I WANT TO DIE" matches', () => {
    const r = fastPathTriage('I WANT TO DIE', []);
    expect(r?.status).toBe('crisis');
  });
});

describe('R-02 classifier disambiguation', () => {
  it('classifier prompt explicitly lists "how are you" as Coaching, not Greeting', () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain('how are you');
  });

  it('classifier prompt lists additional courtesy-beat negative examples', () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain('how was your day');
    expect(TRIAGE_SYSTEM_PROMPT).toContain("hope you're well");
    expect(TRIAGE_SYSTEM_PROMPT).toContain("what's up");
  });

  it('classifier prompt notes embedded "hi" routes to Coaching (e.g., "hi i feel sad")', () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain('hi i feel sad');
  });

  it('Affirmation description tightened: never the opening of a session', () => {
    expect(TRIAGE_SYSTEM_PROMPT.toLowerCase()).toContain('opening');
  });

  it('classifier system prompt snapshot — drift detection trip-wire', () => {
    // Snapshot file at tests/coaching/__snapshots__/triage.test.ts.snap
    // Any unintentional rewording of the prompt will RED this assertion.
    // Update with `pnpm test -u` only when the change is intentional.
    expect(TRIAGE_SYSTEM_PROMPT).toMatchSnapshot();
  });
});

/**
 * Batch G — llmTriage migrated from Groq Llama to Anthropic Haiku 4.5
 * via the classifierChat wrapper. Tests assert the wrapper is invoked
 * (not groqChat) and that all branches (valid/crisis/reject/unknown/
 * error) map correctly to TriageResult.
 */
vi.mock('../../src/shared/llm/classifier.js', () => ({
  classifierChat: vi.fn(),
}));

vi.mock('../../src/shared/llm/groq.js', () => ({
  groqChat: vi.fn(),
}));

vi.mock('../../src/incident-handling/index.js', async () => {
  const actual = await vi.importActual<typeof IncidentHandling>(
    '../../src/incident-handling/index.js',
  );
  return { ...actual, reportP1: vi.fn() };
});

const cfg = {} as unknown as AppConfig;

describe('Batch G — llmTriage on Haiku', () => {
  beforeEach(async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    const groqMod = await import('../../src/shared/llm/groq.js');
    const incidentMod = await import('../../src/incident-handling/index.js');
    vi.mocked(classifierMod.classifierChat).mockReset();
    vi.mocked(groqMod.groqChat).mockReset();
    vi.mocked(incidentMod.reportP1).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls classifierChat (NOT groqChat) for non-fast-path inputs', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    const groqMod = await import('../../src/shared/llm/groq.js');
    vi.mocked(classifierMod.classifierChat).mockResolvedValue({
      text: '{"status":"pass","intent":"Coaching","reason":"ok"}',
      inputTokens: 100,
      outputTokens: 20,
    });

    await triage(cfg, 'a real coaching message about my team', []);

    expect(classifierMod.classifierChat).toHaveBeenCalledTimes(1);
    expect(groqMod.groqChat).not.toHaveBeenCalled();
  });

  it('valid status → {status:"valid", intent:"Coaching"}', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierMod.classifierChat).mockResolvedValue({
      text: '{"status":"pass","intent":"Coaching","reason":"ok"}',
      inputTokens: 100,
      outputTokens: 20,
    });

    const r = await triage(cfg, 'how do i lead my team?', []);

    expect(r.status).toBe('valid');
    expect(r.intent).toBe('Coaching');
  });

  it('crisis status → {status:"crisis"} regardless of intent field', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierMod.classifierChat).mockResolvedValue({
      text: '{"status":"crisis","intent":"Coaching","reason":"indirect cue"}',
      inputTokens: 100,
      outputTokens: 20,
    });

    const r = await triage(cfg, "i don't see the point of any of this", []);

    expect(r.status).toBe('crisis');
    expect(r.reason).toContain('indirect cue');
  });

  it('reject status → {status:"reject"}', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierMod.classifierChat).mockResolvedValue({
      text: '{"status":"reject","intent":"OutOfScope","reason":"abusive"}',
      inputTokens: 100,
      outputTokens: 20,
    });

    const r = await triage(cfg, 'abusive message', []);

    expect(r.status).toBe('reject');
  });

  it('unknown classifier status falls through to valid+Coaching', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierMod.classifierChat).mockResolvedValue({
      text: '{"status":"weird","intent":"Coaching","reason":"unexpected"}',
      inputTokens: 100,
      outputTokens: 20,
    });

    const r = await triage(cfg, 'a coaching message', []);

    expect(r.status).toBe('valid');
    expect(r.intent).toBe('Coaching');
  });

  it('LlmError → fail-open valid+Coaching with P1 incident', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    const incidentMod = await import('../../src/incident-handling/index.js');
    vi.mocked(classifierMod.classifierChat).mockRejectedValue(
      new LlmServiceUnavailableError('anthropic', 'haiku 503'),
    );

    const r = await triage(cfg, 'a coaching message', []);

    expect(r.status).toBe('valid');
    expect(r.intent).toBe('Coaching');
    expect(r.reason).toBe('classifier-fail-open');
    expect(incidentMod.reportP1).toHaveBeenCalledTimes(1);
  });
});
