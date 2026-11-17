import { beforeEach, describe, expect, it } from 'vitest';
import {
  demoBudgetUsed,
  resetDemoBudgetForTests,
  tryConsumeDemoModelCall,
} from '../../../src/shared/llm/demo-budget.js';
import type { AppConfig } from '../../../src/shared/secrets/config.js';

const config = { demoMode: true, demoDailyModelCalls: 2 } as AppConfig;

describe('demo model-call budget', () => {
  beforeEach(() => resetDemoBudgetForTests());

  it('allows calls up to the daily limit, then refuses', () => {
    const day = new Date('2026-11-17T10:00:00Z');
    expect(tryConsumeDemoModelCall(config, day)).toBe(true);
    expect(tryConsumeDemoModelCall(config, day)).toBe(true);
    expect(tryConsumeDemoModelCall(config, day)).toBe(false);
    expect(demoBudgetUsed()).toBe(2);
  });

  it('resets at midnight UTC', () => {
    const late = new Date('2026-11-17T23:59:00Z');
    tryConsumeDemoModelCall(config, late);
    tryConsumeDemoModelCall(config, late);
    expect(tryConsumeDemoModelCall(config, late)).toBe(false);
    expect(tryConsumeDemoModelCall(config, new Date('2026-11-18T00:01:00Z'))).toBe(true);
  });

  it('a limit of zero means no real calls at all', () => {
    const none = { demoMode: true, demoDailyModelCalls: 0 } as AppConfig;
    expect(tryConsumeDemoModelCall(none)).toBe(false);
  });
});
