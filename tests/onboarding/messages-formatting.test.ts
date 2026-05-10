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

// Customer-feedback PR1 — first-message CTA + welcome trim.
// Customer reported sandbox dead-air: after Twilio's "you are all set",
// nothing prompts the user. Twilio sandbox cannot push unsolicited; once
// the user texts in, our welcome must be short and end with a clear CTA.
describe('customer-feedback PR1 — welcome CTA + sponsor-line removal', () => {
  it('combined welcome+consent ends with a CTA on its own visually dominant last line', () => {
    const combined = `${messages.WELCOME_MESSAGE}\n\n${messages.CONSENT_PROMPT}`;
    const lastLine =
      combined
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .at(-1) ?? '';
    // Last line must START with "Reply" (CTA on its own line, not buried mid-paragraph).
    expect(lastLine).toMatch(/^reply\s+\*?yes\*?/i);
    // Last line must be short — a CTA, not another disclosure.
    expect(lastLine.length).toBeLessThan(100);
  });

  it('WELCOME_MESSAGE alone fits inside one WhatsApp single-bubble preview (<320 chars)', () => {
    expect(messages.WELCOME_MESSAGE.length).toBeLessThan(320);
  });

  it('WELCOME_MESSAGE retains brand tagline and framework attribution', () => {
    expect(messages.WELCOME_MESSAGE).toContain('Transforming Leadership for Impact');
    expect(messages.WELCOME_MESSAGE).toContain(
      "Hamse Warfa's 12 Practices of Transformational Leadership",
    );
  });

  it('WELCOME_MESSAGE no longer mentions the sponsor code', () => {
    expect(messages.WELCOME_MESSAGE.toLowerCase()).not.toContain('sponsor code');
    expect(messages.WELCOME_MESSAGE).not.toContain('kobciye-');
  });

  it('combined first message contains both STOP disclosure and the yes CTA', () => {
    const combined = `${messages.WELCOME_MESSAGE}\n\n${messages.CONSENT_PROMPT}`;
    expect(combined).toContain('STOP');
    expect(combined).toMatch(/reply\s+\*?yes\*?/i);
  });
});
