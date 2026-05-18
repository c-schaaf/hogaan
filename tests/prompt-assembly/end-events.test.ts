import { describe, expect, it } from 'vitest';
import { PROMPT_ASSEMBLY_END_EVENTS, isAssemblySuccess } from '../../src/prompt-assembly/index.js';

describe('prompt assembly end events', () => {
  it('exposes 8 events (3 success modes + 5 error variants) after SCRUM-55', () => {
    // SCRUM-55 dropped E2_PromptAssembledWithDegradation and E9_PromptOversize
    // along with the 4000-token budget cascade.
    expect(PROMPT_ASSEMBLY_END_EVENTS).toHaveLength(8);
  });

  it('classifies E1 + E3 + E4 + E10 as success-shaped', () => {
    expect(isAssemblySuccess('E1_PromptAssembledNormal')).toBe(true);
    expect(isAssemblySuccess('E3_PromptAssembledClarifyMode')).toBe(true);
    expect(isAssemblySuccess('E4_PromptAssembledMetaMode')).toBe(true);
    expect(isAssemblySuccess('E10_PromptLogWriteFailed')).toBe(true); // prompt OK, log async
  });

  it('classifies E5–E8 as failures', () => {
    expect(isAssemblySuccess('E5_MalformedInput')).toBe(false);
    expect(isAssemblySuccess('E6_LibraryUnavailable')).toBe(false);
    expect(isAssemblySuccess('E7_PracticeOrLevelTagInvalid')).toBe(false);
    expect(isAssemblySuccess('E8_TemplateMissing')).toBe(false);
  });
});
