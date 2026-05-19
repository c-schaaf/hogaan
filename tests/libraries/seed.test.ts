import { describe, expect, it } from 'vitest';
import {
  crisisResourcesV1,
  crisisResourcesV2,
  promptTemplatesV2Unified,
  scenariosV1,
} from '../../src/libraries/index.js';
import { PRACTICE_TAGS, RESPONSE_MODES } from '../../src/shared/types/index.js';

describe('library seed content invariants', () => {
  it('prompt_templates v2 unified has one entry per response mode, all pointing at coaching_v3_leadership', () => {
    expect(promptTemplatesV2Unified.templates).toHaveLength(RESPONSE_MODES.length);
    const modes = new Set(promptTemplatesV2Unified.templates.map((t) => t.responseMode));
    for (const m of RESPONSE_MODES) {
      expect(modes.has(m)).toBe(true);
    }
    for (const t of promptTemplatesV2Unified.templates) {
      expect(t.id).toBe('coaching_v3_leadership');
    }
  });

  it('prompt_templates v2 unified has empty practice + level framing (baked into systemText)', () => {
    expect(promptTemplatesV2Unified.practiceFraming).toEqual([]);
    expect(promptTemplatesV2Unified.levelFraming).toEqual([]);
  });

  it('crisis_resources v1 ships Tabaha + Befrienders Worldwide (historical baseline)', () => {
    const names = crisisResourcesV1.resources.map((r) => r.name);
    expect(names).toContain('Tabaha');
    expect(names).toContain('Befrienders Worldwide');
  });

  it('crisis_resources v1 has the placeholder phone the v2 publish replaces', () => {
    const tabaha = crisisResourcesV1.resources.find((r) => r.name === 'Tabaha');
    expect(tabaha?.channels[0]?.value).toBe('+252-tbd');
  });

  it('crisis_resources v2 carries the confirmed Tabaha phone number', () => {
    const tabaha = crisisResourcesV2.resources.find((r) => r.name === 'Tabaha');
    expect(tabaha).toBeDefined();
    expect(tabaha?.channels[0]?.value).toBe('+254722178177');
    expect(tabaha?.channels[0]?.note).toMatch(/Confirmed by ops 2026-05-04/);
  });

  it('crisis_resources v2 still ships Befrienders as global fallback', () => {
    const names = crisisResourcesV2.resources.map((r) => r.name);
    expect(names).toContain('Befrienders Worldwide');
  });

  it('crisis_resources v2 holding message is present', () => {
    expect(crisisResourcesV2.holdingMessage.length).toBeGreaterThan(50);
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
