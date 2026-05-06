import { describe, expect, it } from 'vitest';
import { tagPracticeAndLevel } from '../../src/coaching/tagger.js';

/**
 * Phase 12 R11 — precision corpus.
 *
 * 20 leadership-context phrases that previously tripped a wrong practice
 * tag because of common-word keywords ('why', 'voice', 'face', 'change',
 * 'monday morning'). Each phrase asserts the tagger does NOT pick the
 * formerly-tripped practice — either picks something else or falls back
 * to integrity (the v1 default).
 */

const NON_TAGGING_CASES: ReadonlyArray<{ text: string; mustNotTag: string }> = [
  { text: 'I want to change rooms', mustNotTag: 'innovation' },
  { text: 'change the conference room layout', mustNotTag: 'innovation' },
  { text: 'I had to change my flight', mustNotTag: 'innovation' },
  { text: 'we changed strategy mid-quarter', mustNotTag: 'innovation' },
  { text: 'why are we doing it this way', mustNotTag: 'purpose' },
  { text: 'why is this taking so long', mustNotTag: 'purpose' },
  { text: 'why bother with another meeting', mustNotTag: 'purpose' },
  { text: 'lower my voice', mustNotTag: 'democracy' },
  { text: 'her voice carries across the room', mustNotTag: 'democracy' },
  { text: 'I lost my voice from the call', mustNotTag: 'democracy' },
  { text: 'his face was red', mustNotTag: 'dignity' },
  { text: 'face the music', mustNotTag: 'dignity' },
  { text: 'I face this every monday', mustNotTag: 'dignity' },
  { text: 'monday morning standup is dragging', mustNotTag: 'empathy' },
  { text: 'monday morning, the deck must ship', mustNotTag: 'empathy' },
  { text: "I'm thinking about something for monday morning", mustNotTag: 'empathy' },
  { text: 'voice memo from a colleague', mustNotTag: 'democracy' },
  { text: 'change rate is killing us', mustNotTag: 'innovation' },
  { text: 'face value of the offer', mustNotTag: 'dignity' },
  { text: 'why was the deadline missed', mustNotTag: 'purpose' },
];

describe('Phase 12 R11 — tagger precision corpus (no false-positive practice tags)', () => {
  for (const { text, mustNotTag } of NON_TAGGING_CASES) {
    it(`"${text}" does NOT tag ${mustNotTag}`, () => {
      const r = tagPracticeAndLevel(text);
      expect(r.practiceTag, `unexpected ${r.tagSource} tag`).not.toBe(mustNotTag);
    });
  }
});

describe('Phase 12 R11 — phrasal anchors still tag correctly', () => {
  it('"point of this work" → purpose', () => {
    expect(tagPracticeAndLevel('what is the point of this work').practiceTag).toBe('purpose');
  });
  it('"whose voice has not been heard" → democracy', () => {
    expect(tagPracticeAndLevel('whose voice has not been heard').practiceTag).toBe('democracy');
  });
  it('"lose face in front of the team" → dignity', () => {
    expect(tagPracticeAndLevel("I don't want to lose face").practiceTag).toBe('dignity');
  });
  it('"try a different approach" → innovation', () => {
    expect(tagPracticeAndLevel('we should try a different approach').practiceTag).toBe(
      'innovation',
    );
  });
});
