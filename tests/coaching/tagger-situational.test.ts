import { describe, expect, it } from 'vitest';
import { tagPracticeAndLevel } from '../../src/coaching/tagger.js';

/**
 * Phase 12 R13 — situational triggers.
 *
 * The audit's canonical "I had to fire someone today" prompt previously
 * fell back to 'integrity' (the v1 default) because no abstract keyword
 * fired. Real users describe situations, not principles. R13 added
 * situational triggers per practice. The §7.3 sample prompts must now
 * tag correctly.
 *
 * Threshold: ≥ 70% match between tagger output and expected practice
 * across the 12 §7.3 prompts.
 */

interface Sample {
  prompt: string;
  expected: ReadonlyArray<string>; // any of these is acceptable
}

// PRD §7.3 sample prompts (audit-ratified mapping).
const SAMPLES: ReadonlyArray<Sample> = [
  { prompt: 'I had to fire someone today', expected: ['accountability', 'integrity'] },
  { prompt: 'My team missed a deadline for the third time', expected: ['accountability'] },
  { prompt: 'I want to do the right thing but it costs me', expected: ['integrity'] },
  {
    prompt: 'My direct report is going through a hard time at home',
    expected: ['empathy'],
  },
  { prompt: 'One member never says anything in meetings', expected: ['inclusion'] },
  { prompt: 'My two senior engineers are at each other every week', expected: ['peace'] },
  {
    prompt: 'The decision fell to me and I made the call',
    expected: ['accountability'],
  },
  { prompt: "I don't know if I should keep doing this work", expected: ['purpose', 'humility'] },
  { prompt: 'We need to try a different approach', expected: ['innovation'] },
  {
    prompt: 'I had to let go of a long-time team member',
    expected: ['accountability'],
  },
  { prompt: 'I need to admit I was wrong', expected: ['humility'] },
  { prompt: 'My team is deadlocked on this hire', expected: ['peace'] },
];

describe('Phase 12 R13 — §7.3 sample-prompt tagging', () => {
  it('canonical "I had to fire someone" tags accountability OR integrity', () => {
    const r = tagPracticeAndLevel('I had to fire someone today');
    expect(['accountability', 'integrity']).toContain(r.practiceTag);
  });

  it('§7.3 sample prompts tag the expected practice ≥70% of the time', () => {
    let hits = 0;
    const misses: string[] = [];
    for (const s of SAMPLES) {
      const r = tagPracticeAndLevel(s.prompt);
      if (s.expected.includes(r.practiceTag)) {
        hits += 1;
      } else {
        misses.push(
          `"${s.prompt}" → got ${r.practiceTag}, expected one of ${s.expected.join('|')}`,
        );
      }
    }
    const matchRate = hits / SAMPLES.length;
    expect(
      matchRate,
      `match rate ${(matchRate * 100).toFixed(0)}%; misses:\n${misses.join('\n')}`,
    ).toBeGreaterThanOrEqual(0.7);
  });
});
