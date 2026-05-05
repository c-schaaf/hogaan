import { describe, expect, it } from 'vitest';
import { parseScenarioState } from '../../src/scenario-learning/state.js';

describe('parseScenarioState', () => {
  it('returns empty state when profileFlags is null', () => {
    expect(parseScenarioState(null)).toEqual({ active: null, completed: [] });
    expect(parseScenarioState(undefined)).toEqual({ active: null, completed: [] });
  });

  it('parses a well-formed activeScenario', () => {
    const flags = {
      activeScenario: {
        scenarioId: 'integrity-the-shortcut',
        currentStep: 2,
        startedAt: '2026-05-04T10:00:00Z',
      },
    };
    const state = parseScenarioState(flags);
    expect(state.active).toEqual({
      scenarioId: 'integrity-the-shortcut',
      currentStep: 2,
      startedAt: '2026-05-04T10:00:00Z',
    });
    expect(state.completed).toEqual([]);
  });

  it('rejects malformed activeScenario shapes', () => {
    expect(parseScenarioState({ activeScenario: { scenarioId: 'x' } }).active).toBeNull();
    expect(
      parseScenarioState({ activeScenario: { scenarioId: 'x', currentStep: 'one' } }).active,
    ).toBeNull();
    expect(parseScenarioState({ activeScenario: 'not-an-object' }).active).toBeNull();
  });

  it('parses completedScenarios as a string array', () => {
    const state = parseScenarioState({
      completedScenarios: ['integrity-the-shortcut', 'purpose-the-reset', 42, null],
    });
    expect(state.completed).toEqual(['integrity-the-shortcut', 'purpose-the-reset']);
  });

  it('handles both active and completed together', () => {
    const flags = {
      dailyPromptsOptedIn: true,
      activeScenario: {
        scenarioId: 'empathy-the-monday',
        currentStep: 1,
        startedAt: '2026-05-04T10:00:00Z',
      },
      completedScenarios: ['integrity-the-shortcut'],
    };
    const state = parseScenarioState(flags);
    expect(state.active?.scenarioId).toBe('empathy-the-monday');
    expect(state.completed).toEqual(['integrity-the-shortcut']);
  });
});
