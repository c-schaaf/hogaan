import { describe, expect, it } from 'vitest';
import { PROMPT_ASSEMBLY_END_EVENTS, isAssemblySuccess } from '../../src/prompt-assembly/index.js';

describe('prompt assembly end events', () => {
  it('exposes 10 events (4 success modes + 6 error variants)', () => {
    expect(PROMPT_ASSEMBLY_END_EVENTS).toHaveLength(10);
  });

  it('classifies E1–E4 + E10 as success-shaped', () => {
    expect(isAssemblySuccess('E1_PromptAssembledNormal')).toBe(true);
    expect(isAssemblySuccess('E2_PromptAssembledWithDegradation')).toBe(true);
    expect(isAssemblySuccess('E3_PromptAssembledClarifyMode')).toBe(true);
    expect(isAssemblySuccess('E4_PromptAssembledMetaMode')).toBe(true);
    expect(isAssemblySuccess('E10_PromptLogWriteFailed')).toBe(true); // prompt OK, log async
  });

  it('classifies E5–E9 as failures', () => {
    expect(isAssemblySuccess('E5_MalformedInput')).toBe(false);
    expect(isAssemblySuccess('E6_LibraryUnavailable')).toBe(false);
    expect(isAssemblySuccess('E7_PracticeOrLevelTagInvalid')).toBe(false);
    expect(isAssemblySuccess('E8_TemplateMissing')).toBe(false);
    expect(isAssemblySuccess('E9_PromptOversize')).toBe(false);
  });
});
