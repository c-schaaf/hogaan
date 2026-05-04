import { describe, expect, it } from 'vitest';
import {
  handleConsentReply,
  handleGoalReply,
  handleLocationReply,
  handleRoleReply,
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

describe('handleGoalReply with retry budget', () => {
  it('advances to step 4 with the parsed goals on attempt 1', () => {
    const r = handleGoalReply('1, 3', 1);
    expect(r.newStep).toBe(4);
    expect(r.defaultsApplied).toBe(false);
    expect(r.dataUpdate?.goals).toEqual(['Leadership confidence', 'Conflict resolution']);
  });

  it('re-asks on attempt 1 when input is invalid', () => {
    const r = handleGoalReply('???', 1);
    expect(r.newStep).toBe(3); // stays on step 3 (consent) waiting for goal
    expect(r.defaultsApplied).toBe(false);
  });

  it('applies defaults on attempt 3 when still invalid (E7 path)', () => {
    const r = handleGoalReply('???', 3);
    expect(r.newStep).toBe(4);
    expect(r.defaultsApplied).toBe(true);
    expect(r.dataUpdate?.goals).toEqual(['Leadership confidence']);
    expect(r.dataUpdate?.needsProfileReview).toBe(true);
  });
});

describe('handleRoleReply with retry budget', () => {
  it('advances to step 5 on a clean parse', () => {
    const r = handleRoleReply('manager', 1);
    expect(r.newStep).toBe(5);
    expect(r.defaultsApplied).toBe(false);
    expect(r.dataUpdate?.role).toBe('Leader');
  });

  it('applies Professional default after 3 invalid attempts', () => {
    const r = handleRoleReply('purple', 3);
    expect(r.newStep).toBe(5);
    expect(r.defaultsApplied).toBe(true);
    expect(r.dataUpdate?.role).toBe('Professional');
    expect(r.dataUpdate?.needsProfileReview).toBe(true);
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
