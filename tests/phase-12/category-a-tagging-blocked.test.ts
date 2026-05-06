import { describe, it } from 'vitest';

/**
 * Phase 12 Category A — RED tests blocked on Hamse keyword signoff.
 *
 * These scenarios from the 50-scenario voice-fidelity spec assert that
 * realistic Somali-leadership user phrasings produce the documented
 * practice/level tag. The current keyword list in src/coaching/tagger.ts
 * does NOT match these phrasings, so each test would fail. Per
 * CLAUDE.md hard rule #3, keyword additions touching voice-anchored
 * concepts require Hamse approval.
 *
 * Once approved, each it.todo can be promoted to it() with the assertion
 * already documented in plan §3 Phase R / Phase G.
 */
describe('Phase 12 — Category A: Tagging accuracy (BLOCKED on keyword signoff)', () => {
  it.todo(
    'T18: "Engineering and Product hate each other." → organization (current: self fallback)',
  );
});
