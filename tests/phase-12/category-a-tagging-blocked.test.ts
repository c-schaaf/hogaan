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
  it.todo('T2: "Why am I EVEN doing this work?" → purpose (current: integrity fallback)');
  it.todo('T4: "I think he LOST face." → dignity (current: integrity fallback)');
  it.todo('T6: "quiet team member who NEVER SPEAKS UP" → inclusion (current: integrity fallback)');
  it.todo('T7: "cost-cutting mode... morale is low" → assets / organization');
  it.todo('T8: "We need a DIFFERENT way of working... scared to change" → innovation');
  it.todo('T9: "We just closed a big deal... compounds" → prosperity / organization');
  it.todo('T11: "same three voices DOMINATE every decision" → democracy / community');
  it.todo('T15: "Monday standup so it does not feel like a status update" → team');
  it.todo('T16: "I do not trust my number two anymore" → team (verify substring match)');
  it.todo('T17: "Our company values are written down but no one acts on them" → organization');
  it.todo(
    'T18: "Engineering and Product hate each other." → organization (current: self fallback)',
  );
  it.todo('T19: "running for the diaspora council" → community');
  it.todo('T20: "want to start a foundation" → community');
});
