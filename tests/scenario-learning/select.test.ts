import { describe, expect, it } from 'vitest';
import { selectScenario } from '../../src/scenario-learning/index.js';
import { scenariosV1 } from '../../src/libraries/index.js';

const all = scenariosV1.scenarios;

describe('selectScenario — practice-name match', () => {
  it('matches when the user names a practice explicitly', () => {
    const r = selectScenario({
      message: "let's practice integrity",
      scenarios: all,
      completedScenarioIds: [],
    });
    expect(r).not.toBeNull();
    expect(r?.scenario.practice).toBe('integrity');
    expect(r?.reason).toBe('practice_name_match');
  });

  it('matches case-insensitively and tolerates surrounding text', () => {
    const r = selectScenario({
      message: 'I want to work on PURPOSE this week',
      scenarios: all,
      completedScenarioIds: [],
    });
    expect(r?.scenario.practice).toBe('purpose');
  });
});

describe('selectScenario — keyword match', () => {
  it('falls through to a fallback when only generic words are used', () => {
    // Generic verbs/nouns ("handling", "difficult", "conversation") have no
    // overlap with any scenario title or pitch. Selector should still return
    // SOMETHING useful via the uncompleted fallback rather than null.
    const r = selectScenario({
      message: "let's practice handling a difficult conversation",
      scenarios: all,
      completedScenarioIds: [],
    });
    expect(r).not.toBeNull();
    expect(typeof r?.scenario.id).toBe('string');
  });

  it('uses keyword overlap on titles + pitches', () => {
    const r = selectScenario({
      message: 'I need to fire someone next week',
      scenarios: all,
      completedScenarioIds: [],
    });
    // dignity-the-firing has "firing" in title — should match.
    expect(r).not.toBeNull();
    expect(r?.scenario.id).toBe('dignity-the-firing');
  });
});

describe('selectScenario — fallbacks', () => {
  it('falls back to first uncompleted when no keywords match', () => {
    const r = selectScenario({
      message: 'xxxx yyyy zzzz',
      scenarios: all,
      completedScenarioIds: [all[0]!.id],
    });
    expect(r?.reason).toBe('first_uncompleted');
    expect(r?.scenario.id).not.toBe(all[0]!.id);
  });

  it('falls back to first in library when everything is completed', () => {
    const r = selectScenario({
      message: 'xxxx yyyy zzzz',
      scenarios: all,
      completedScenarioIds: all.map((s) => s.id),
    });
    expect(r?.reason).toBe('first_in_library');
    expect(r?.scenario.id).toBe(all[0]!.id);
  });

  it('returns null when the library is empty', () => {
    expect(
      selectScenario({ message: 'anything', scenarios: [], completedScenarioIds: [] }),
    ).toBeNull();
  });
});
