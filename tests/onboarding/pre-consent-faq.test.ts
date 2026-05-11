import { describe, expect, it } from 'vitest';
import { detectPreConsentFaq } from '../../src/onboarding/pre-consent-faq.js';

/**
 * Khadija UX Reframe — pre-consent FAQ pattern matching.
 *
 * The handler intercepts questions a user might type before consenting,
 * answers them with a canned line, and nudges back to "Reply yes / sow."
 * Anything not matched falls through to the existing consent re-ask path.
 */

describe('detectPreConsentFaq — mentor pattern', () => {
  it.each([
    'I want a mentor',
    'I want a mentor, can i get a live mentor',
    'Can I get a live mentor?',
    'Looking for a real coach',
    'is this matchmaking',
    'Do you offer human coach matching?',
  ])('matches: %s', (input) => {
    const r = detectPreConsentFaq(input);
    expect(r).not.toBeNull();
    expect(r?.faq).toBe('mentor');
    expect(r?.reply).toMatch(/mentor/i);
    expect(r?.reply).toMatch(/yes\s*\/?\s*sow/i);
  });
});

describe('detectPreConsentFaq — daily prompts pattern', () => {
  it.each([
    'What will the daily prompts be about',
    'What are daily prompts',
    'whats a daily prompt',
    'what prompts will I get',
    'what will the prompts be about',
  ])('matches: %s', (input) => {
    const r = detectPreConsentFaq(input);
    expect(r).not.toBeNull();
    expect(r?.faq).toBe('daily_prompts');
    expect(r?.reply).toMatch(/daily prompts? are/i);
    expect(r?.reply).toMatch(/yes\s*\/?\s*sow/i);
  });
});

describe('detectPreConsentFaq — scope pattern', () => {
  it.each([
    'what do you do',
    'What is this',
    'what is hogaan',
    'How does this work',
    'how does it work',
    'tell me about hogaan',
    'tell me about you',
    'who is hogaan',
  ])('matches: %s', (input) => {
    const r = detectPreConsentFaq(input);
    expect(r).not.toBeNull();
    expect(r?.faq).toBe('scope');
    expect(r?.reply).toMatch(/leadership coach|hamse warfa/i);
    expect(r?.reply).toMatch(/yes\s*\/?\s*sow/i);
  });
});

describe('detectPreConsentFaq — non-matches fall through to null', () => {
  it.each([
    '',
    'yes',
    'no',
    'sow',
    'haa',
    'maybe later',
    'asdfgh',
    'I picked self',
    'integrity and peace',
  ])('returns null for: "%s"', (input) => {
    expect(detectPreConsentFaq(input)).toBeNull();
  });
});

describe('detectPreConsentFaq — case insensitivity', () => {
  it('matches uppercase mentor', () => {
    expect(detectPreConsentFaq('MENTOR PLEASE')?.faq).toBe('mentor');
  });
  it('matches mixed case daily prompts', () => {
    expect(detectPreConsentFaq('What ARE the Daily Prompts?')?.faq).toBe('daily_prompts');
  });
});

describe('detectPreConsentFaq — order resolution', () => {
  it('mentor fires before scope when both could match', () => {
    // "what do you do about mentor" — has both "what do you do" (scope)
    // and "mentor" — mentor pattern should fire first because it's listed
    // first in the function.
    const r = detectPreConsentFaq('what do you do about finding a mentor');
    expect(r?.faq).toBe('mentor');
  });
});
