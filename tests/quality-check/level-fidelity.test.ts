import { describe, expect, it } from 'vitest';
import { check16LevelFidelity, _internal } from '../../src/quality-check/checks-rule-based.js';
import type { LevelTag } from '../../src/shared/types/index.js';

const { ON_LEVEL_PHRASES, OFF_LEVEL_PHRASES } = _internal;

/**
 * Batch P Piece 2 — deterministic Check 16 level-fidelity. Uses an
 * off-level vs on-level density signal to flag responses whose tagged
 * level (self/team/organization/community) doesn't match the response's
 * actual anchor.
 *
 * Conservative thresholds: at least 2 off-level hits AND off-level
 * density > 2× on-level density. False negatives are caught downstream
 * by the LLM-judged Check 17.
 */

describe('Batch P Piece 2 — check16 level fidelity', () => {
  describe('on-level pass (no drift)', () => {
    const onLevelCandidates: Record<LevelTag, string> = {
      self: "I'm sitting with this hard call. I notice I keep returning to my own integrity here. What I feel matters here, even before I tell anyone.",
      team: 'My team has been through a lot. The one-on-one with my report tomorrow will set the tone. The team meeting after that needs to land.',
      organization:
        'The org has shifted. Cross-functional friction is the real story. Company-wide patterns will keep repeating until we name what is structural.',
      community:
        'The civic stakes here are real. The community I work with deserves a clear answer. Public trust in this sector is fragile.',
    };

    for (const lvl of ['self', 'team', 'organization', 'community'] as const) {
      it(`${lvl}-tagged on-level response → pass`, () => {
        const r = check16LevelFidelity(onLevelCandidates[lvl], lvl, 'FullCoachingResponse');
        expect(r.checkId).toBe('check_16_level_fidelity');
        expect(r.outcome.status).toBe('pass');
      });
    }
  });

  describe('off-level drift → soft_fail', () => {
    it('self-tagged response heavy on team/org phrasing → soft_fail', () => {
      const candidate =
        'Your team needs to step up. Your colleagues are watching. The org is in flux. Cross-functional friction is the real issue here. Company-wide, the pattern repeats. The team should rethink its priorities.';
      const r = check16LevelFidelity(candidate, 'self', 'FullCoachingResponse');
      expect(r.outcome.status).toBe('soft_fail');
      if (r.outcome.status === 'soft_fail') {
        expect(r.outcome.reason).toContain('level drift');
        expect(r.outcome.reason).toContain('self');
      }
    });

    it('team-tagged response heavy on self / org introspection → soft_fail', () => {
      const candidate =
        'Within yourself, find the answer. Your own integrity is the test. Company-wide, the org is in flux. Cross-functional patterns dominate. The civic stakes are real. The sectoral picture matters.';
      const r = check16LevelFidelity(candidate, 'team', 'FullCoachingResponse');
      expect(r.outcome.status).toBe('soft_fail');
    });

    it('organization-tagged response heavy on self introspection → soft_fail', () => {
      const candidate =
        'Within yourself, the answer lives. Your own conviction matters most. The team meeting next week is small. The one-on-one with your report is small. Civic considerations matter. Community at large is the stage.';
      const r = check16LevelFidelity(candidate, 'organization', 'FullCoachingResponse');
      expect(r.outcome.status).toBe('soft_fail');
    });

    it('community-tagged response heavy on self / private-org phrasing → soft_fail', () => {
      const candidate =
        'Within yourself, name the question. Your own intent. Your team needs you. Company-wide patterns. The org is in flux.';
      const r = check16LevelFidelity(candidate, 'community', 'FullCoachingResponse');
      expect(r.outcome.status).toBe('soft_fail');
    });
  });

  describe('skip semantics', () => {
    it('non-FullCoachingResponse → not_required', () => {
      const candidate = 'Anything goes here, drift or not.';
      const r = check16LevelFidelity(candidate, 'self', 'MetaResponse');
      expect(r.outcome.status).toBe('not_required');
    });

    it('undefined levelTag → not_required', () => {
      const candidate = 'Anything goes here.';
      const r = check16LevelFidelity(candidate, undefined, 'FullCoachingResponse');
      expect(r.outcome.status).toBe('not_required');
    });
  });

  describe('threshold conservatism', () => {
    it('single off-level mention does NOT trigger (1-hit floor)', () => {
      // One mention of "the org" in an otherwise self-anchored response.
      const candidate =
        "I'm sitting with my own integrity on this. I notice the pattern within me. The org context is just background — what matters is what I decide.";
      const r = check16LevelFidelity(candidate, 'self', 'FullCoachingResponse');
      expect(r.outcome.status).toBe('pass');
    });

    it('off-level density barely exceeding 2× on-level → triggers', () => {
      // 3 off-level hits, 1 on-level hit → 3 > 1*2 → triggers.
      const candidate =
        'I notice this. Your team needs help. The team should regroup. Your colleagues are unsure.';
      const r = check16LevelFidelity(candidate, 'self', 'FullCoachingResponse');
      expect(r.outcome.status).toBe('soft_fail');
    });
  });

  describe('phrase catalogs', () => {
    it('ON_LEVEL_PHRASES has entries for all 4 levels', () => {
      for (const lvl of ['self', 'team', 'organization', 'community'] as const) {
        expect(ON_LEVEL_PHRASES[lvl].length).toBeGreaterThan(0);
      }
    });

    it('OFF_LEVEL_PHRASES has entries for all 4 levels', () => {
      for (const lvl of ['self', 'team', 'organization', 'community'] as const) {
        expect(OFF_LEVEL_PHRASES[lvl].length).toBeGreaterThan(0);
      }
    });
  });
});
