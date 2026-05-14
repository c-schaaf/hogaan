import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fastPathTriage } from '../../src/coaching/index.js';
import { TRIAGE_SYSTEM_PROMPT, llmTriage } from '../../src/coaching/triage.js';
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

  it('returns null on benign messages → defers to LLM classifier', () => {
    expect(fastPathTriage('I have a leadership question', [])).toBeNull();
    expect(fastPathTriage('Hi, how do I lead my team?', [])).toBeNull();
  });

  it('returns null for messages that would previously have triggered crisis detection', () => {
    expect(fastPathTriage('I want to kill myself', [])).toBeNull();
    expect(fastPathTriage('My partner beats me', [])).toBeNull();
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

// Khadija UX Reframe (2026-05-11) — tighten ProfileUpdate + MetaQuestion
// classifier guidance to stop hijacking coaching messages.
describe('Khadija UX Reframe — classifier guidance prevents intent hijacking', () => {
  it('ProfileUpdate guidance distinguishes past-tense facts from leadership challenges', () => {
    const t = TRIAGE_SYSTEM_PROMPT;
    expect(t.toLowerCase()).toMatch(/past tense|already happened|fact change/);
    expect(t).toContain('me stepping up as mentor');
  });

  it('MetaQuestion guidance excludes coaching-content questions', () => {
    const t = TRIAGE_SYSTEM_PROMPT;
    expect(t).toMatch(/what examples of leadership/i);
    expect(t).toMatch(/i want a mentor/i);
    expect(t).toMatch(/who are you|are you ai|are you hamse/i);
  });

  it('Coaching remains the default — explicit "when in doubt" guidance preserved', () => {
    expect(TRIAGE_SYSTEM_PROMPT.toLowerCase()).toMatch(/when in doubt|if unsure/);
  });
});

/**
 * Batch G — llmTriage migrated from Groq Llama to Anthropic Haiku 4.5
 * via the classifierChat wrapper.
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

    await llmTriage(cfg, 'a real coaching message about my team');

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

    const r = await llmTriage(cfg, 'how do i lead my team?');

    expect(r.status).toBe('valid');
    expect(r.intent).toBe('Coaching');
  });

  it('reject status → {status:"reject"}', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierMod.classifierChat).mockResolvedValue({
      text: '{"status":"reject","intent":"OutOfScope","reason":"abusive"}',
      inputTokens: 100,
      outputTokens: 20,
    });

    const r = await llmTriage(cfg, 'abusive message');

    expect(r.status).toBe('reject');
  });

  it('unknown classifier status falls through to valid+Coaching', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    vi.mocked(classifierMod.classifierChat).mockResolvedValue({
      text: '{"status":"weird","intent":"Coaching","reason":"unexpected"}',
      inputTokens: 100,
      outputTokens: 20,
    });

    const r = await llmTriage(cfg, 'a coaching message');

    expect(r.status).toBe('valid');
    expect(r.intent).toBe('Coaching');
  });

  it('LlmError → fail-open valid+Coaching with P1 incident', async () => {
    const classifierMod = await import('../../src/shared/llm/classifier.js');
    const incidentMod = await import('../../src/incident-handling/index.js');
    vi.mocked(classifierMod.classifierChat).mockRejectedValue(
      new LlmServiceUnavailableError('anthropic', 'haiku 503'),
    );

    const r = await llmTriage(cfg, 'a coaching message');

    expect(r.status).toBe('valid');
    expect(r.intent).toBe('Coaching');
    expect(r.reason).toBe('classifier-fail-open');
    expect(incidentMod.reportP1).toHaveBeenCalledTimes(1);
  });
});
