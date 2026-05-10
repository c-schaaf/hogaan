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

  it('re-asks on ambiguous', () => {
    const r = handleConsentReply('what is this?');
    expect(r.newStep).toBe(2);
    expect(r.outboundBody).not.toBeNull();
  });
});

describe('handleGoalReply with retry budget (Phase 12 R14 — 12-practice picker)', () => {
  it('advances to step 4 with the parsed practices on attempt 1', () => {
    const r = handleGoalReply('integrity, peace', 1);
    expect(r.newStep).toBe(4);
    expect(r.defaultsApplied).toBe(false);
    expect(r.dataUpdate?.goals).toContain('integrity');
    expect(r.dataUpdate?.goals).toContain('peace');
  });

  it('re-asks on attempt 1 when input is invalid', () => {
    const r = handleGoalReply('???', 1);
    expect(r.newStep).toBe(3); // stays on step 3 (consent) waiting for goal
    expect(r.defaultsApplied).toBe(false);
  });

  it('applies integrity default on attempt 3 when still invalid (E7 path)', () => {
    const r = handleGoalReply('???', 3);
    expect(r.newStep).toBe(4);
    expect(r.defaultsApplied).toBe(true);
    expect(r.dataUpdate?.goals).toEqual(['integrity']);
    expect(r.dataUpdate?.needsProfileReview).toBe(true);
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
