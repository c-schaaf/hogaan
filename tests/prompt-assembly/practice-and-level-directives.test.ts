import { describe, expect, it } from 'vitest';
import { _internal } from '../../src/prompt-assembly/assembler.js';
import type { LevelTag, PracticeTag } from '../../src/shared/types/index.js';

const { LEVEL_GUIDANCE, buildDirectivesBlock } = _internal;

/**
 * Batch P Piece 1 — structural directives block. Tells the LLM to use the
 * tagged practice as the organizing frame and to anchor at the tagged level.
 * Engineering-authored framing; not Hamse content. Tested via the _internal
 * builder so the per-(practice, level) combinations are deterministic.
 *
 * The directives block is injected by canonicalAssemble between the level
 * framing and the voice rules sections — see assembler.ts.
 */

describe('Batch P Piece 1 — directives block', () => {
  describe('LEVEL_GUIDANCE catalog', () => {
    it('has a clause for each of the four levels', () => {
      const levels: LevelTag[] = ['self', 'team', 'organization', 'community'];
      for (const lvl of levels) {
        expect(LEVEL_GUIDANCE[lvl]).toBeDefined();
        expect(LEVEL_GUIDANCE[lvl].length).toBeGreaterThan(20);
      }
    });

    it("self-level guidance anchors on the leader's interior", () => {
      expect(LEVEL_GUIDANCE.self.toLowerCase()).toContain('interior');
    });

    it('team-level guidance anchors on dynamics + relationships', () => {
      expect(LEVEL_GUIDANCE.team.toLowerCase()).toContain('dynamics');
    });

    it('organization-level guidance anchors on structural / cultural / cross-functional', () => {
      expect(LEVEL_GUIDANCE.organization.toLowerCase()).toMatch(
        /structural|cultural|cross-functional/,
      );
    });

    it('community-level guidance anchors on civic / sectoral / community', () => {
      expect(LEVEL_GUIDANCE.community.toLowerCase()).toMatch(/civic|sectoral|community/);
    });
  });

  describe('buildDirectivesBlock — per-combo coverage', () => {
    const samples: Array<[PracticeTag, LevelTag]> = [
      ['integrity', 'self'],
      ['accountability', 'team'],
      ['empathy', 'team'],
      ['inclusion', 'team'],
      ['assets', 'organization'],
      ['innovation', 'organization'],
      ['humility', 'community'],
      ['democracy', 'community'],
    ];

    for (const [practice, level] of samples) {
      it(`practice=${practice}, level=${level} → block names both`, () => {
        const block = buildDirectivesBlock(practice, level);
        expect(block).toContain(practice);
        expect(block).toContain(`${level}-level`);
        // The structural directive should explicitly use the
        // "organizing frame" wording so the LLM sees it.
        expect(block.toLowerCase()).toContain('organizing frame');
        // And it should embed the LEVEL_GUIDANCE clause for the tagged level.
        expect(block).toContain(LEVEL_GUIDANCE[level]);
      });
    }
  });

  describe('buildDirectivesBlock — null-tag bypass', () => {
    it('returns empty string when practiceTag is null (untagged response mode)', () => {
      expect(buildDirectivesBlock(null, 'self')).toBe('');
    });

    it('returns empty string when levelTag is null', () => {
      expect(buildDirectivesBlock('integrity', null)).toBe('');
    });

    it('returns empty string when both are null', () => {
      expect(buildDirectivesBlock(null, null)).toBe('');
    });
  });

  describe('buildDirectivesBlock — snapshot trip-wire', () => {
    it('canonical (integrity, self) directives block snapshot', () => {
      // Drift detection. If the directive copy changes intentionally, run
      // `pnpm test -u` to update. Anything else is a regression.
      expect(buildDirectivesBlock('integrity', 'self')).toMatchSnapshot();
    });
  });
});
