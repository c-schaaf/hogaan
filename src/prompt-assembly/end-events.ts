/**
 * Process #9 has 4 success-path terminal modes (E1–E4) plus 6 error events
 * (E5–E10). The mode the prompt was built for is part of the OutputBundle —
 * Process #2 §9 dispatches on it to set the LLM call shape.
 */
export const PROMPT_ASSEMBLY_END_EVENTS = [
  'E1_PromptAssembledNormal',
  'E2_PromptAssembledWithDegradation',
  'E3_PromptAssembledClarifyMode',
  'E4_PromptAssembledMetaMode',
  'E5_MalformedInput',
  'E6_LibraryUnavailable',
  'E7_PracticeOrLevelTagInvalid',
  'E8_TemplateMissing',
  'E9_PromptOversize',
  'E10_PromptLogWriteFailed',
] as const;

export type PromptAssemblyEndEvent = (typeof PROMPT_ASSEMBLY_END_EVENTS)[number];

export function isAssemblySuccess(event: PromptAssemblyEndEvent): boolean {
  return (
    event === 'E1_PromptAssembledNormal' ||
    event === 'E2_PromptAssembledWithDegradation' ||
    event === 'E3_PromptAssembledClarifyMode' ||
    event === 'E4_PromptAssembledMetaMode' ||
    event === 'E10_PromptLogWriteFailed'
  );
}
