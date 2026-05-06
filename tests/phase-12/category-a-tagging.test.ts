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

  it('T2: "Why am I even doing this work?... feel pointless" → purpose', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T2-feel-pointless',
        controlId: 'T5.VoiceFidelity.T2_FeelPointless',
        tier: 'T5',
        description:
          'Existential meaning question with "pointless" / "why am i even" → purpose practice. Approved keywords (verbatim): "pointless", "why am i even".',
      },
      () => {
        const r = tagPracticeAndLevel(
          'Why am I even doing this work? Some days the meetings just feel pointless.',
        );
        expect(r.practiceTag).toBe('purpose');
      },
    );
  });

  it('T4: "...He went quiet. I think he lost face." → dignity (practice axis)', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T4-lost-face',
        controlId: 'T5.VoiceFidelity.T4_LostFace',
        tier: 'T5',
        description:
          'Past-tense "lost face" → dignity practice. Approved keywords: "lost face", "losing face". Level axis not asserted: §3 keyword approval covers practice only; the spec sentence has no team-level keyword, so level falls back to self.',
      },
      () => {
        const r = tagPracticeAndLevel(
          'I gave hard feedback to a senior person in a meeting. He went quiet. I think he lost face.',
        );
        expect(r.practiceTag).toBe('dignity');
      },
    );
  });

  it('T6: "quiet team member who never speaks up" → inclusion / team', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T6-never-speaks-up',
        controlId: 'T5.VoiceFidelity.T6_NeverSpeaksUp',
        tier: 'T5',
        description:
          '"never speaks up" variant catches the inclusion practice. Approved keywords: "never speaks up", "never speak up".',
      },
      () => {
        const r = tagPracticeAndLevel(
          'There is a quiet team member who never speaks up but I think she has the best ideas. How do I bring her in?',
        );
        expect(r.practiceTag).toBe('inclusion');
      },
    );
  });

  it('T7: "cost-cutting mode... morale is low" → assets / organization', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T7-cost-cutting-assets',
        controlId: 'T5.VoiceFidelity.T7_CostCutting',
        tier: 'T5',
        description:
          'Asset-based reframe target — "morale is low" + "what we don\'t have" / "scarcity" → assets practice. Approved keywords: "what we don\'t have", "morale is low", "scarcity". Level=organization driven by existing "the org" keyword in spec sentence.',
      },
      () => {
        const r = tagPracticeAndLevel(
          "The org is in cost-cutting mode. Morale is low. I keep hearing what we don't have.",
        );
        expect(r.practiceTag).toBe('assets');
        expect(r.levelTag).toBe('organization');
      },
    );
  });

  it('T8: "different way of working" → innovation', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T8-different-way',
        controlId: 'T5.VoiceFidelity.T8_DifferentWay',
        tier: 'T5',
        description:
          '"different way of working" variant catches innovation practice. Approved keyword: "different way of working".',
      },
      () => {
        const r = tagPracticeAndLevel(
          'We need a different way of working. The current one is broken but everyone is scared to change.',
        );
        expect(r.practiceTag).toBe('innovation');
      },
    );
  });

  it('T9: "closed a big deal... compounds" → prosperity', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T9-closed-deal-compounds',
        controlId: 'T5.VoiceFidelity.T9_ClosedDeal',
        tier: 'T5',
        description:
          'Long-view prosperity framing — compounding wins. Approved keywords: "compound", "compounds", "compounding".',
      },
      () => {
        const r = tagPracticeAndLevel(
          "We just closed a big deal. Now I'm thinking about how to make sure the win actually compounds.",
        );
        expect(r.practiceTag).toBe('prosperity');
      },
    );
  });

  it('T11: "same three voices dominate every decision" → democracy', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T11-voices-dominate',
        controlId: 'T5.VoiceFidelity.T11_VoicesDominate',
        tier: 'T5',
        description:
          'Unequal-participation framing → democracy practice. Approved keywords: "voices dominate", "dominate every decision", "never weigh in".',
      },
      () => {
        const r = tagPracticeAndLevel(
          "I'm on a board where the same three voices dominate every decision. The other six never weigh in.",
        );
        expect(r.practiceTag).toBe('democracy');
      },
    );
  });

  it('T19: "running for the diaspora council... not sure I should" → humility / community', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T19-diaspora-council',
        controlId: 'T5.VoiceFidelity.T19_DiasporaCouncil',
        tier: 'T5',
        description:
          'Self-questioning candidacy framing → humility practice; diaspora council → community level. Approved keywords (practice): "i\'m not sure", "not sure i should". Approved keywords (level): "diaspora", "diaspora council", "community council", "civic council".',
      },
      () => {
        const r = tagPracticeAndLevel(
          "I'm thinking about running for the diaspora council. I'm not sure I should.",
        );
        expect(r.practiceTag).toBe('humility');
        expect(r.levelTag).toBe('community');
      },
    );
  });

  it('T15: "Monday standup so it does not feel like a status update" → team', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T15-monday-standup',
        controlId: 'T5.VoiceFidelity.T15_MondayStandup',
        tier: 'T5',
        description:
          'Recurring team-meeting framing → team level. Approved keywords: "standup", "stand-up", "team meeting", "one-on-ones".',
      },
      () => {
        const r = tagPracticeAndLevel(
          'How do I run my Monday standup so it does not feel like a status update?',
        );
        expect(r.levelTag).toBe('team');
      },
    );
  });

  it('T16: "I do not trust my number two anymore" → team', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T16-number-two',
        controlId: 'T5.VoiceFidelity.T16_NumberTwo',
        tier: 'T5',
        description:
          'Deputy / second-in-command relationship → team level (relationship-as-unit). Approved keywords: "number two", "my deputy", "my second", "my right hand".',
      },
      () => {
        const r = tagPracticeAndLevel('I do not trust my number two anymore.');
        expect(r.levelTag).toBe('team');
      },
    );
  });

  it('T20: "want to start a foundation... vanity or service" → humility / community', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T20-foundation',
        controlId: 'T5.VoiceFidelity.T20_Foundation',
        tier: 'T5',
        description:
          'Philanthropic-foundation framing → community level; "i don\'t know" already drives humility practice (no practice add needed). Approved level keywords: "foundation", "nonprofit", "philanthropy".',
      },
      () => {
        const r = tagPracticeAndLevel(
          "I want to start a foundation. I don't know if it's vanity or service.",
        );
        expect(r.practiceTag).toBe('humility');
        expect(r.levelTag).toBe('community');
      },
    );
  });

  it('T18: "Engineering and Product hate each other." → peace / organization', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T18-org-functions-peace',
        controlId: 'T5.VoiceFidelity.T18_OrgFunctions',
        tier: 'T5',
        description:
          'Inter-functional org friction → peace practice + organization level. Approved practice keywords: "hate each other", "don\'t get along", "always fighting". Approved level keywords: "engineering and product", "product and engineering", "and sales", "and marketing", "cross-functional".',
      },
      () => {
        const r = tagPracticeAndLevel('Engineering and Product hate each other.');
        expect(r.practiceTag).toBe('peace');
        expect(r.levelTag).toBe('organization');
      },
    );
  });

  it('T17 (regression-lock): "Our company values are written down..." → organization', async () => {
    await withVoiceFidelityEvidence(
      {
        testId: 'phase-12/voice-fidelity/T17-company-values',
        controlId: 'T5.VoiceFidelity.T17_CompanyValues',
        tier: 'T5',
        description:
          'Regression lock: passes against existing code without source change. "company" already routes to LEVEL_KEYWORDS.organization; practice falls back to integrity which satisfies pptx "integrity or accountability" set.',
        details: {
          disposition: 'regression-lock',
          note: 'passed against existing code without source change',
        },
      },
      () => {
        const r = tagPracticeAndLevel(
          'Our company values are written down but no one acts on them.',
        );
        expect(r.levelTag).toBe('organization');
        expect(['integrity', 'accountability']).toContain(r.practiceTag);
      },
    );
  });
});
