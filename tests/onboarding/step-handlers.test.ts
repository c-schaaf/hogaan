import { describe, expect, it } from 'vitest';
import {
  handleConsentReply,
  handleExperienceReply,
  handleGoalReply,
  handleLocationReply,
} from '../../src/onboarding/step-handlers.js';

describe('handleConsentReply', () => {
  it('advances on yes', () => {
    const r = handleConsentReply('yes');
    expect(r.newStep).toBe(3);
    expect(r.terminalEvent).toBeUndefined();
  });

  it('terminates on no', () => {
    const r = handleConsentReply('no thank you');
    expect(r.terminalEvent).toBe('E3_ConsentDeclined');
  });

  it('re-asks on truly ambiguous (non-FAQ) input', () => {
    const r = handleConsentReply('asdfgh');
    expect(r.newStep).toBe(2);
    expect(r.outboundBody).not.toBeNull();
    // Generic re-ask uses the canonical CONSENT_PROMPT — not a FAQ reply.
    expect(r.outboundBody?.toLowerCase()).toContain('three quick checks');
  });
});

// Khadija UX Reframe — pre-consent FAQ routes through handleConsentReply.
describe('handleConsentReply — pre-consent FAQ', () => {
  it('matches mentor pattern and replies with the FAQ text, staying on step 2', () => {
    const r = handleConsentReply('I want a mentor, can i get a live mentor');
    expect(r.newStep).toBe(2);
    expect(r.outboundBody).toMatch(/mentor-matching service/i);
    expect(r.outboundBody).toMatch(/yes\s*\/?\s*sow/i);
  });

  it('matches daily-prompts pattern', () => {
    const r = handleConsentReply('What will the daily prompts be about');
    expect(r.newStep).toBe(2);
    expect(r.outboundBody).toMatch(/daily prompts? are/i);
  });

  it('matches scope pattern', () => {
    const r = handleConsentReply('what is this?');
    expect(r.newStep).toBe(2);
    expect(r.outboundBody).toMatch(/leadership coach/i);
  });
});

// Khadija UX Reframe — handleGoalReply now finalizes onboarding (newStep=7).
// Single-message ack + FIRST_COACHING_PROMPT replaces the old experience-band
// hand-off. Experience and location no longer asked during onboarding.
describe('handleGoalReply with retry budget (Khadija UX Reframe — onboarding collapses at step 4)', () => {
  it('advances to step 7 with the parsed practices on attempt 1', () => {
    const r = handleGoalReply('integrity, peace', 1);
    expect(r.newStep).toBe(7);
    expect(r.defaultsApplied).toBe(false);
    expect(r.dataUpdate?.goals).toContain('integrity');
    expect(r.dataUpdate?.goals).toContain('peace');
  });

  it('dispatches inline-gloss ack + FIRST_COACHING_PROMPT in one message', () => {
    const r = handleGoalReply('integrity, peace', 1);
    expect(r.outboundBody).toMatch(/integrity/);
    expect(r.outboundBody).toMatch(/peace/);
    // FIRST_COACHING_PROMPT.
    expect(r.outboundBody).toMatch(/leadership challenge/i);
  });

  it('re-asks on attempt 1 when input is invalid', () => {
    const r = handleGoalReply('???', 1);
    expect(r.newStep).toBe(3); // stays on step 3 (consent) waiting for goal
    expect(r.defaultsApplied).toBe(false);
  });

  it('applies integrity default on attempt 3 and finalizes at step 7', () => {
    const r = handleGoalReply('???', 3);
    expect(r.newStep).toBe(7);
    expect(r.defaultsApplied).toBe(true);
    expect(r.dataUpdate?.goals).toEqual(['integrity']);
    expect(r.dataUpdate?.needsProfileReview).toBe(true);
    // Default path still produces ack + coaching prompt.
    expect(r.outboundBody).toMatch(/integrity/);
    expect(r.outboundBody).toMatch(/leadership challenge/i);
  });
});

// Customer-feedback PR4 — replace role with experience band.
describe('handleExperienceReply with retry budget', () => {
  it('advances to step 5 on a clean prose parse', () => {
    const r = handleExperienceReply('5 to 10', 1);
    expect(r.newStep).toBe(5);
    expect(r.defaultsApplied).toBe(false);
    expect(r.dataUpdate?.experienceBand).toBe('5-10');
  });

  it('advances to step 5 on a digit parse', () => {
    const r = handleExperienceReply('12', 1);
    expect(r.newStep).toBe(5);
    expect(r.dataUpdate?.experienceBand).toBe('10+');
  });

  it('applies <5 default after 3 invalid attempts', () => {
    const r = handleExperienceReply('purple', 3);
    expect(r.newStep).toBe(5);
    expect(r.defaultsApplied).toBe(true);
    expect(r.dataUpdate?.experienceBand).toBe('<5');
    expect(r.dataUpdate?.needsProfileReview).toBe(true);
  });

  it('re-asks on attempt 1 when input is invalid', () => {
    const r = handleExperienceReply('purple', 1);
    expect(r.newStep).toBe(4);
    expect(r.defaultsApplied).toBe(false);
    expect(r.outboundBody).not.toBeNull();
  });
});

describe('handleLocationReply', () => {
  it('captures location and timezone for a Horn-of-Africa city', () => {
    const r = handleLocationReply('Mogadishu');
    expect(r.dataUpdate?.location).toBe('Mogadishu');
    expect(r.dataUpdate?.isDiaspora).toBe(false);
    expect(r.dataUpdate?.timezone).toBe('Africa/Mogadishu');
  });

  it('skips on "skip" and defaults to East Africa Time', () => {
    const r = handleLocationReply('skip');
    expect(r.dataUpdate?.location).toBeUndefined();
    expect(r.dataUpdate?.timezone).toBe('Africa/Mogadishu');
    expect(r.dataUpdate?.isDiaspora).toBe(false);
  });

  it('flags diaspora for non-HoA city', () => {
    const r = handleLocationReply('Toronto, Canada');
    expect(r.dataUpdate?.isDiaspora).toBe(true);
  });
});
