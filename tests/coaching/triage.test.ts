import { describe, expect, it } from 'vitest';
import { fastPathTriage, _CRISIS_KEYWORDS } from '../../src/coaching/index.js';
import { TRIAGE_SYSTEM_PROMPT } from '../../src/coaching/triage.js';

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
