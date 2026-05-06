import { describe, it, expect } from 'vitest';
import { tagPracticeAndLevel } from '../../src/coaching/tagger.js';
import { withVoiceFidelityEvidence } from './helpers/evidence-vf.js';

/**
 * Phase 12 Category A — Tagger accuracy regression for the verifiable-green
 * subset of T1–T20.
 *
 * Currently green (this file): T1, T3, T5, T10, T12, T13.
 *
 * Currently RED — gated on Hamse keyword signoff (per plan §6 BLOCKERS;
 * tracked in tests/phase-12/category-a-tagging.blocked.test.ts.skip):
 *   - T2  ("why am I EVEN doing"): keyword is literal `why am i doing`
 *   - T4  ("LOST face"): keyword is `lose face`
 *   - T6  ("NEVER SPEAKS up"): keywords cover `doesn't speak up`, not the variant
 *   - T7  cost-cutting / morale-low → assets (no matching keywords)
 *   - T8  ("DIFFERENT way of working"): keyword is `new way of working`
 *   - T9  closed-deal / compounds → prosperity (no matching keywords)
 *   - T11 same-three-voices-dominate → democracy (no matching keywords)
 *   - T14 leader-blames-self spec ambiguity (Hamse decision)
 *   - T15 monday-standup → team (no matching keywords)
 *   - T16 number-two → team (rely on `one of my` substring; verify)
 *   - T17 company-values → organization (verify)
 *   - T18 engineering-vs-product → organization (no level keyword present)
 *   - T19 diaspora-council → community (no matching keywords)
 *   - T20 foundation → community (no matching keywords)
 *
 * Tagger contract: tagPracticeAndLevel(message, profileMapped[]) → TagResult.
 * Empty profileMapped exercises the message-driven branch.
 */
describe('Phase 12 — Category A: Tagging accuracy (green subset)', () => {
  it('T1: "I had to fire someone today..." → integrity OR accountability', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T1-fire-someone',
        controlId: 'T5.VoiceFidelity.T1_FireSomeone',
        tier: 'T5',
        description:
          'Hard call about firing — should land on integrity OR accountability practice. Keyword "had to fire" routes to accountability.',
      },
      () => {
        const r = tagPracticeAndLevel(
          'I had to fire someone today. They had a kid on the way. Not sure I made the right call.',
        );
        expect(['integrity', 'accountability']).toContain(r.practiceTag);
      },
    );
  });

  it('T3: "My team missed the deadline... I need to own this" → accountability', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T3-own-this',
        controlId: 'T5.VoiceFidelity.T3_OwnThis',
        tier: 'T5',
        description: 'Explicit "own this" + missed deadline → accountability practice.',
      },
      () => {
        const r = tagPracticeAndLevel(
          'My team missed the deadline for the third time. I need to own this.',
        );
        expect(r.practiceTag).toBe('accountability');
      },
    );
  });

  it('T5: "...going through a divorce. Their work is suffering." → empathy', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T5-going-through',
        controlId: 'T5.VoiceFidelity.T5_GoingThrough',
        tier: 'T5',
        description:
          'Personal-life challenge affecting work → empathy practice via "going through" keyword.',
      },
      () => {
        const r = tagPracticeAndLevel(
          "One of my reports is going through a divorce. Their work is suffering. I don't know what to say.",
        );
        expect(r.practiceTag).toBe('empathy');
      },
    );
  });

  it('T10: "Got pushback I didn\'t expect. I think they\'re right." → humility', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T10-pushback',
        controlId: 'T5.VoiceFidelity.T10_Pushback',
        tier: 'T5',
        description: 'Pushback acknowledged-as-correct → humility practice via "pushback" keyword.',
      },
      () => {
        const r = tagPracticeAndLevel(
          "I gave a talk at a sector convening. Got pushback I didn't expect. I think they're right.",
        );
        expect(r.practiceTag).toBe('humility');
      },
    );
  });

  it('T12: "...two community organizations... in a public feud." → peace', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T12-public-feud',
        controlId: 'T5.VoiceFidelity.T12_PublicFeud',
        tier: 'T5',
        description: 'Inter-org feud framing → peace practice via "feud" keyword.',
      },
      () => {
        const r = tagPracticeAndLevel(
          'Two community organizations I work with are in a public feud. Each thinks they speak for the same people.',
        );
        expect(r.practiceTag).toBe('peace');
      },
    );
  });

  it('T13: "I am sleepless about a decision..." → level=self', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T13-sleepless',
        controlId: 'T5.VoiceFidelity.T13_Sleepless',
        tier: 'T5',
        description: 'Personal sleeplessness about decision → level=self via "i\'m sleepless".',
      },
      () => {
        const r = tagPracticeAndLevel("I'm sleepless about a decision I have to make tomorrow.");
        expect(r.levelTag).toBe('self');
      },
    );
  });

  it('T14: "My team is failing because of me." → level=self override', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T14-leader-blames-self',
        controlId: 'T5.VoiceFidelity.T14_LeaderBlamesSelf',
        tier: 'T5',
        description:
          'Phase 12 T14 — leader-responsibility phrase ("because of me") forces level=self even when "my team" team-keyword is also present. The leader is the unit when accepting blame.',
      },
      () => {
        const r = tagPracticeAndLevel('My team is failing because of me.');
        expect(r.levelTag).toBe('self');
      },
    );
  });

  it('T14 precedence: multiple team-keyword hits + "because of me"/"my fault" → level=self', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T14-self-override-precedence',
        controlId: 'T5.VoiceFidelity.T14_SelfOverridePrecedence',
        tier: 'T5',
        description:
          'T14 deterministic precedence proof — a message with multiple team-level signals AND a self-override phrase still lands at level=self. Drives the SELF_OVERRIDE_PHRASES rule in tagPracticeAndLevel.',
      },
      () => {
        const r = tagPracticeAndLevel(
          "my team has been struggling and it's because of me, my fault really",
        );
        expect(r.levelTag).toBe('self');
      },
    );
  });
});
