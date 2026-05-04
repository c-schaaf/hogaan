import { describe, expect, it } from 'vitest';
import {
  crisisResourcesV1,
  culturalFramingV1,
  promptTemplatesV1,
  scenariosV1,
  voiceRulesV1,
} from '../../src/libraries/index.js';
import { LEVEL_TAGS, PRACTICE_TAGS, RESPONSE_MODES } from '../../src/shared/types/index.js';

describe('library seed content invariants', () => {
  it('voice_rules has exactly 10 rules with stable ids', () => {
    expect(voiceRulesV1.rules).toHaveLength(10);
    const ids = voiceRulesV1.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(10);
  });

  it('voice_rules ships hero-phrase flags + useful-to-society anchor patterns', () => {
    expect(voiceRulesV1.heroPhraseFlags.length).toBeGreaterThan(0);
    expect(voiceRulesV1.usefulToSocietyPatterns.length).toBeGreaterThan(0);
  });

  it('cultural_framing has exactly 15 framings with unique concepts', () => {
    expect(culturalFramingV1.framings).toHaveLength(15);
    const concepts = culturalFramingV1.framings.map((f) => f.concept);
    expect(new Set(concepts).size).toBe(15);
  });

  it('cultural_framing every framing has at least one applicableWhen + examplePhrasings', () => {
    for (const f of culturalFramingV1.framings) {
      expect(f.applicableWhen.length).toBeGreaterThan(0);
      expect(f.examplePhrasings.length).toBeGreaterThan(0);
    }
  });

  it('prompt_templates has 5 templates, one per response mode', () => {
    expect(promptTemplatesV1.templates).toHaveLength(RESPONSE_MODES.length);
    const modes = new Set(promptTemplatesV1.templates.map((t) => t.responseMode));
    for (const m of RESPONSE_MODES) {
      expect(modes.has(m)).toBe(true);
    }
  });

  it('prompt_templates has 12 practice framings, one per practice', () => {
    expect(promptTemplatesV1.practiceFraming).toHaveLength(PRACTICE_TAGS.length);
    const practices = new Set(promptTemplatesV1.practiceFraming.map((f) => f.practice));
    for (const p of PRACTICE_TAGS) {
      expect(practices.has(p)).toBe(true);
    }
  });

  it('prompt_templates has 4 level framings, one per level', () => {
    expect(promptTemplatesV1.levelFraming).toHaveLength(LEVEL_TAGS.length);
    const levels = new Set(promptTemplatesV1.levelFraming.map((f) => f.level));
    for (const l of LEVEL_TAGS) {
      expect(levels.has(l)).toBe(true);
    }
  });

  it('crisis_resources includes Tabaha + Befrienders Worldwide (per user decision)', () => {
    const names = crisisResourcesV1.resources.map((r) => r.name);
    expect(names).toContain('Tabaha');
    expect(names).toContain('Befrienders Worldwide');
  });

  it('crisis_resources holding message is present', () => {
    expect(crisisResourcesV1.holdingMessage.length).toBeGreaterThan(50);
  });

  it('scenarios has 12, one per practice, with multi-turn steps', () => {
    expect(scenariosV1.scenarios).toHaveLength(PRACTICE_TAGS.length);
    const practices = new Set(scenariosV1.scenarios.map((s) => s.practice));
    for (const p of PRACTICE_TAGS) {
      expect(practices.has(p)).toBe(true);
    }
    for (const s of scenariosV1.scenarios) {
      expect(s.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of s.steps) {
        expect(step.coachPrompt.length).toBeGreaterThan(0);
        expect(step.evaluationCriteria.length).toBeGreaterThan(0);
      }
    }
  });

  it('scenarios have unique ids', () => {
    const ids = scenariosV1.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
