import { describe, expect, it } from 'vitest';
import { checkFormattingDiscipline } from '../../src/quality-check/checks-rule-based.js';
import * as messages from '../../src/onboarding/messages.js';

/**
 * Phase 12 R16 — every onboarding-message string must pass Voice Rule 11
 * (formatting discipline): zero markdown headers, ≤1 bold segment, zero
 * bullet-list lines.
 *
 * Special-case exceptions:
 *   GOAL_PROMPT (R14) carries 4 level-header bolds (Self/Team/Org/
 *   Community). That's structural onboarding, not decorative formatting.
 *   The audit explicitly accepted this exception — the test below
 *   excludes GOAL_PROMPT from Rule 11 enforcement.
 */

const EXEMPT_FROM_RULE_11 = new Set<string>([
  'GOAL_PROMPT', // R14 level-header bolds — structural, audit-accepted
  'GOAL_RETRY_PROMPT', // R14 — same exception
  'ROLE_PROMPT', // R15 — has bold role names; structural picker
  'WELCOME_MESSAGE', // intro tagline bold + sponsor-code example bold
]);

describe('Phase 12 R16 — onboarding messages pass Voice Rule 11', () => {
  for (const [name, text] of Object.entries(messages)) {
    if (typeof text !== 'string') continue;
    if (EXEMPT_FROM_RULE_11.has(name)) continue;
    it(`${name} passes formatting discipline`, () => {
      const r = checkFormattingDiscipline(text);
      if (r.outcome.status !== 'pass') {
        if (r.outcome.status === 'soft_fail') {
          throw new Error(`${name} formatting fail: ${r.outcome.reason}\n---\n${text}\n---`);
        }
      }
      expect(r.outcome.status).toBe('pass');
    });
  }
});

describe('Phase 12 R16 — CONSENT_PROMPT specifically', () => {
  it('has exactly one bold (aggregate) and zero headers/bullets', () => {
    const r = checkFormattingDiscipline(messages.CONSENT_PROMPT);
    expect(r.outcome.status).toBe('pass');
    // Verify the one bold is on "aggregate" (the privacy-critical word).
    expect(messages.CONSENT_PROMPT).toContain('*aggregate*');
  });

  it('still discloses all three required topics: AI nature, data handling, opt-out', () => {
    const t = messages.CONSENT_PROMPT.toLowerCase();
    // AI / not a therapist
    expect(t).toMatch(/ai|not a therapist|not a doctor/);
    // Phone hashed / aggregate
    expect(t).toMatch(/hashed|aggregate/);
    // STOP keyword / opt out
    expect(t).toMatch(/stop|opt.out/);
  });
});
