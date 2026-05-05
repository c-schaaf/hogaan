import { describe, expect, it } from 'vitest';
import { selectDailyPrompt, type SelectionContext } from '../../src/daily-prompt/selection.js';
import { dailyPromptsV1 } from '../../src/libraries/index.js';
import { asUserId, type PracticeTag } from '../../src/shared/types/index.js';

const userA = asUserId('11111111-aaaa-aaaa-aaaa-111111111111');
const userB = asUserId('22222222-bbbb-bbbb-bbbb-222222222222');
const dateA = '2026-05-04';
const dateB = '2026-05-05';

const noHistory: SelectionContext = { recentHistory: [] };

describe('selectDailyPrompt — determinism', () => {
  it('returns the same prompt for the same (userId, dateKey) across re-runs', () => {
    const r1 = selectDailyPrompt(
      { userId: userA, dateKey: dateA, payload: dailyPromptsV1 },
      noHistory,
    );
    const r2 = selectDailyPrompt(
      { userId: userA, dateKey: dateA, payload: dailyPromptsV1 },
      noHistory,
    );
    expect(r1).not.toBeNull();
    expect(r2?.prompt.id).toBe(r1?.prompt.id);
  });

  it('different users on the same day get tiebroken by hash, may diverge', () => {
    const rA = selectDailyPrompt(
      { userId: userA, dateKey: dateA, payload: dailyPromptsV1 },
      noHistory,
    );
    const rB = selectDailyPrompt(
      { userId: userB, dateKey: dateA, payload: dailyPromptsV1 },
      noHistory,
    );
    expect(rA).not.toBeNull();
    expect(rB).not.toBeNull();
    // Both users get *some* selection — they may or may not match (and that's fine).
    expect(typeof rA?.prompt.id).toBe('string');
    expect(typeof rB?.prompt.id).toBe('string');
  });

  it('same user on different days picks DIFFERENT practices when both unseen', () => {
    // Both days unseen — tiebreaker uses hash including dateKey, so days
    // should pick differently most of the time. Verify with a sample of days.
    const ids = new Set<string>();
    for (let d = 0; d < 14; d += 1) {
      const dateKey = `2026-05-${String(d + 1).padStart(2, '0')}`;
      const r = selectDailyPrompt({ userId: userA, dateKey, payload: dailyPromptsV1 }, noHistory);
      if (r !== null) {
        ids.add(`${r.prompt.practice}:${r.prompt.id}`);
      }
    }
    // 14 days, hash distribution should pick at least 5 distinct (practice, id) pairs.
    expect(ids.size).toBeGreaterThanOrEqual(5);
  });
});

describe('selectDailyPrompt — practice rotation', () => {
  it('prefers a practice the user has not seen recently over one they just saw', () => {
    // Force userA to have seen integrity yesterday — selection should NOT
    // pick integrity (some other practice should win the rotation).
    const yesterday = new Date('2026-05-03T08:00:00Z');
    const ctx: SelectionContext = {
      recentHistory: [
        { practice: 'integrity', promptId: 'integrity-01-question', sentAt: yesterday },
      ],
    };
    const result = selectDailyPrompt(
      { userId: userA, dateKey: dateB, payload: dailyPromptsV1 },
      ctx,
    );
    expect(result).not.toBeNull();
    expect(result?.prompt.practice).not.toBe<PracticeTag>('integrity');
  });

  it('cycles through all 12 practices over a long enough window', () => {
    // Simulate 12 consecutive days for one user, accumulating history each day.
    const seenPractices = new Set<PracticeTag>();
    let history: SelectionContext['recentHistory'] = [];
    for (let d = 0; d < 12; d += 1) {
      const dateKey = `2026-05-${String(d + 1).padStart(2, '0')}`;
      const sentAt = new Date(`${dateKey}T08:00:00Z`);
      const r = selectDailyPrompt(
        { userId: userA, dateKey, payload: dailyPromptsV1 },
        { recentHistory: history },
      );
      expect(r).not.toBeNull();
      seenPractices.add(r!.prompt.practice);
      history = [{ practice: r!.prompt.practice, promptId: r!.prompt.id, sentAt }, ...history];
    }
    // Over 12 days the user should have seen all 12 distinct practices.
    expect(seenPractices.size).toBe(12);
  });
});

describe('selectDailyPrompt — history dedup', () => {
  it('skips a prompt-id sent recently within the same practice', () => {
    // userA's only "least seen" practice is integrity, but they got
    // integrity-01-question recently — selector must hand them
    // integrity-02-reflection (the other prompt under integrity) OR move
    // to a different practice.
    const yesterday = new Date('2026-05-03T08:00:00Z');
    // Block 11 of 12 practices behind a recent send so integrity is the
    // least-recently-seen practice the rotation picks.
    const allOthers = [
      'purpose',
      'accountability',
      'dignity',
      'empathy',
      'inclusion',
      'assets',
      'innovation',
      'prosperity',
      'humility',
      'democracy',
      'peace',
    ] as const;
    const recentHistory: SelectionContext['recentHistory'] = [
      // integrity sent earliest — 5 days ago — so it's the rotation pick
      {
        practice: 'integrity',
        promptId: 'integrity-01-question',
        sentAt: new Date('2026-04-29T08:00:00Z'),
      },
      ...allOthers.map((p) => ({
        practice: p,
        promptId: `${p}-01-question`,
        sentAt: yesterday,
      })),
    ];
    const result = selectDailyPrompt(
      { userId: userA, dateKey: dateB, payload: dailyPromptsV1 },
      { recentHistory },
    );
    expect(result).not.toBeNull();
    if (result?.prompt.practice === 'integrity') {
      expect(result.prompt.id).not.toBe('integrity-01-question');
    }
  });
});

describe('selectDailyPrompt — empty payload', () => {
  it('returns null on empty prompts', () => {
    const r = selectDailyPrompt(
      { userId: userA, dateKey: dateA, payload: { prompts: [], notes: '' } },
      noHistory,
    );
    expect(r).toBeNull();
  });
});
