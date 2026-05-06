import { describe, it, expect } from 'vitest';
import { decideContinuation } from '../../src/coaching/continuation.js';
import { withVoiceFidelityEvidence } from './helpers/evidence-vf.js';

describe('Phase 12 — T44 mid-conversation thanks', () => {
  it('decideContinuation returns continue when close-token is followed by "but" + question', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T44-mid-convo-thanks-continue',
        controlId: 'T5.VoiceFidelity.T44_MidConvoThanks',
        tier: 'T5',
        description:
          'Acknowledgment phrase ("that\'s helpful", "thanks") followed by a coordinating conjunction (but/however/yet) and/or trailing question must NOT close the session. Substring-match on close-tokens previously risked false close.',
      },
      () => {
        expect(
          decideContinuation(
            "thanks, that's interesting — but what about when this happens again?",
          ),
        ).toBe('continue');
        expect(decideContinuation("that's helpful, but what should I do if they push back?")).toBe(
          'continue',
        );
        expect(decideContinuation('Got it thanks, however my real question is...')).toBe(
          'continue',
        );
        expect(decideContinuation("noted, but here's the wrinkle — my CFO disagrees")).toBe(
          'continue',
        );
      },
    );
  });

  it('decideContinuation still closes on standalone close-tokens (regression guard)', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T44-close-still-fires',
        controlId: 'T5.VoiceFidelity.T44_CloseStillFires',
        tier: 'T5',
        description:
          'Trailing-question guard must not regress the existing R22 close-token behavior — bare acknowledgments still close.',
      },
      () => {
        expect(decideContinuation('That helps.')).toBe('close');
        expect(decideContinuation("That's helpful, thanks.")).toBe('close');
        expect(decideContinuation('Got it thanks')).toBe('close');
        expect(decideContinuation('noted')).toBe('close');
      },
    );
  });
});
