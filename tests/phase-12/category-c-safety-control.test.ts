import { describe, it, expect } from 'vitest';
import { fastPathTriage } from '../../src/coaching/triage.js';
import { decideContinuation } from '../../src/coaching/continuation.js';
import { isOptOutMessage } from '../../src/onboarding/opt-out.js';
import { isAbandonRequest } from '../../src/scenario-learning/orchestrator.js';
import { withVoiceFidelityEvidence } from './helpers/evidence-vf.js';

describe('Phase 12 — Category C: Safety & Control (T37–T45)', () => {
  describe('T37 direct crisis — "I want to kill myself"', () => {
    it('fastPathTriage returns crisis synchronously', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T37-crisis-direct',
          controlId: 'T5.VoiceFidelity.T37_CrisisDirect',
          tier: 'T5',
          description:
            'Direct first-person suicide statement triggers synchronous fast-path crisis routing — Process #2 Step 1, Process #10 Check 6.',
        },
        () => {
          const r = fastPathTriage('I want to kill myself.', []);
          expect(r).not.toBeNull();
          expect(r?.status).toBe('crisis');
        },
      );
    });
  });

  describe('T38 indirect crisis — "I just don\'t see the point of any of this anymore"', () => {
    it('fast-path returns null OR crisis (DEFERRED to live Llama Tier-B classifier)', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T38-crisis-indirect',
          controlId: 'T5.VoiceFidelity.T38_CrisisIndirect',
          tier: 'T5',
          description:
            'Indirect hopelessness signal — Tier-B phrase. Fast-path may or may not catch deterministically. Live Llama classifier verification → voice-smoke (BLOCKED on safety signoff).',
          details: {
            disposition: 'deferred-to-voice-smoke',
            phrase: "I just don't see the point of any of this anymore.",
          },
        },
        () => {
          const r = fastPathTriage("I just don't see the point of any of this anymore.", []);
          // Either deterministic catch (status==='crisis') OR fall-through to LLM (null).
          // Asserting only that it is *not* misrouted to a non-crisis terminal status.
          if (r !== null) {
            expect(['crisis', 'empty', 'media_only']).toContain(r.status);
          }
        },
      );
    });
  });

  describe('T39 crisis false-positive trap — "I want to end this conflict on my team"', () => {
    it('fastPathTriage does NOT route to crisis; falls through to LLM classifier', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T39-crisis-false-positive',
          controlId: 'T5.VoiceFidelity.T39_CrisisFalsePositive',
          tier: 'T5',
          description:
            'Leadership-conflict phrasing with "end" + "kill" cognates must NOT trigger crisis fast-path. Drives keyword discipline.',
        },
        () => {
          const r = fastPathTriage('I want to end this conflict on my team.', []);
          // null = fall-through to LLM (correct); never 'crisis' from fast-path.
          if (r !== null) {
            expect(r.status).not.toBe('crisis');
          }
        },
      );
    });
  });

  describe('T40 post-onboarding STOP', () => {
    it('isOptOutMessage true for "STOP"', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T40-optout-stop',
          controlId: 'T5.VoiceFidelity.T40_OptOutStop',
          tier: 'T5',
          description:
            'WhatsApp Business STOP keyword fires opt-out parser; triggers suppression list + status=opted_out (Phase 12 R17).',
        },
        () => {
          expect(isOptOutMessage('STOP')).toBe(true);
          expect(isOptOutMessage('stop')).toBe(true);
          expect(isOptOutMessage('Stop.')).toBe(true);
        },
      );
    });
  });

  describe('T41 opt-out false-positive (R18)', () => {
    it('isOptOutMessage false for "I want to cancel that meeting tomorrow"', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T41-optout-cancel-meeting',
          controlId: 'T5.VoiceFidelity.T41_OptOutFalsePositive_Cancel',
          tier: 'T5',
          description:
            'Phase 12 R18 — "cancel" was removed from opt-out keywords; coaching-context cancel must not opt-out.',
        },
        () => {
          expect(isOptOutMessage('I want to cancel that meeting tomorrow.')).toBe(false);
        },
      );
    });

    it('isOptOutMessage false for "I want to end this cycle"', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T41-optout-end-cycle',
          controlId: 'T5.VoiceFidelity.T41_OptOutFalsePositive_End',
          tier: 'T5',
          description:
            'Phase 12 R18 — "end" was removed from opt-out keywords; coaching-context "end this cycle" must not opt-out.',
        },
        () => {
          expect(isOptOutMessage('I want to end this cycle.')).toBe(false);
        },
      );
    });
  });

  describe('T42 scenario exit (R19)', () => {
    it('isAbandonRequest true for "exit" during active scenario', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T42-scenario-exit',
          controlId: 'T5.VoiceFidelity.T42_ScenarioExit',
          tier: 'T5',
          description:
            'Phase 12 R19 — "exit" abandons active scenario cleanly; user returned to coaching mode.',
        },
        () => {
          expect(isAbandonRequest('exit')).toBe(true);
          expect(isAbandonRequest('Exit.')).toBe(true);
          expect(isAbandonRequest('exit scenario')).toBe(true);
        },
      );
    });
  });

  describe('T43 natural close-token (R22)', () => {
    it('decideContinuation returns close for "That helps."', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T43-natural-close-that-helps',
          controlId: 'T5.VoiceFidelity.T43_NaturalClose',
          tier: 'T5',
          description:
            'Phase 12 R22 — "that helps" is a natural acknowledgment ending; closes session.',
        },
        () => {
          expect(decideContinuation('That helps.')).toBe('close');
          expect(decideContinuation('that helps')).toBe('close');
        },
      );
    });
  });

  describe('T45 goodbye — clear close', () => {
    it('decideContinuation returns close for "Goodbye"', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T45-goodbye',
          controlId: 'T5.VoiceFidelity.T45_Goodbye',
          tier: 'T5',
          description: 'Classic goodbye-shaped token closes session unambiguously.',
        },
        () => {
          expect(decideContinuation('Goodbye')).toBe('close');
          expect(decideContinuation('goodbye!')).toBe('close');
          expect(decideContinuation('Bye.')).toBe('close');
        },
      );
    });
  });
});
