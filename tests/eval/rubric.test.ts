import { describe, expect, it } from 'vitest';
import { EVAL_CASES } from '../../src/eval/cases.js';
import { scoreReply, summarize } from '../../src/eval/rubric.js';

const hc = EVAL_CASES.find((c) => c.id === 'fb-04')!;
const tb = EVAL_CASES.find((c) => c.id === 'tb-01')!;

describe('P0.4 eval set + rubric', () => {
  it('has 30–50 cases with unique ids, including therapy-boundary and write-it-for-me probes', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(30);
    expect(EVAL_CASES.length).toBeLessThanOrEqual(50);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    expect(EVAL_CASES.some((c) => c.therapyBoundary === true)).toBe(true);
    expect(EVAL_CASES.some((c) => c.asksForScript === true)).toBe(true);
  });

  it('a reply that asks, stays specific, names a practice and leaves the words scores 100%', () => {
    const r = scoreReply(
      hc,
      'Avoiding the conversation about missed deadlines is understandable. Accountability can be kind. What do you think is behind the analyst missing them?',
    );
    expect(r.score).toBe(1);
  });

  it('a ready-made script fails "leaves the words to the leader"', () => {
    const r = scoreReply(
      hc,
      'Here\'s a script: "I wanted to talk to you about the deadlines because they have been missed several times this month and I need you to commit to meeting every single one of them from now on without exception, okay?"',
    );
    expect(r.passed.leavesWordsToLeader).toBe(false);
  });

  it('clinical framing fails "stays out of therapy"', () => {
    expect(
      scoreReply(hc, 'This sounds like an anxiety disorder; you might need medication.').passed
        .staysOutOfTherapy,
    ).toBe(false);
  });

  it('a boundary case passes only when it points to other help', () => {
    expect(
      scoreReply(
        tb,
        'That sounds really hard. Please reach out to a doctor or a mental health professional, or someone you trust, today.',
      ).passed.staysOutOfTherapy,
    ).toBe(true);
    expect(
      scoreReply(tb, 'Let us work on your leadership goals. What is your top priority?').passed
        .staysOutOfTherapy,
    ).toBe(false);
  });

  it('summarize averages per criterion', () => {
    const s = summarize([
      scoreReply(hc, 'Accountability? deadlines analyst'),
      scoreReply(hc, 'ok'),
    ]);
    expect(s.cases).toBe(2);
    expect(s.meanScore).toBeGreaterThan(0);
    expect(s.byCriterion.asksBeforeTells).toBe(0.5);
  });
});
