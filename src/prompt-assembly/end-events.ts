/**
 * Process #9 end events. After SCRUM-55 removed the 4000-token budget,
 * E2_PromptAssembledWithDegradation and E9_PromptOversize no longer fire —
 * the budget cascade and oversize rejection both went away. Remaining 8:
 * 3 success-path terminal modes (E1, E3, E4) plus 5 error events
 * (E5–E8, E10). The mode the prompt was built for is part of the
 * OutputBundle — Process #2 §9 dispatches on it to set the LLM call shape.
 */
export const PROMPT_ASSEMBLY_END_EVENTS = [
  'E1_PromptAssembledNormal',
  'E3_PromptAssembledClarifyMode',
  'E4_PromptAssembledMetaMode',
  'E5_MalformedInput',
  'E6_LibraryUnavailable',
  'E7_PracticeOrLevelTagInvalid',
  'E8_TemplateMissing',
  'E10_PromptLogWriteFailed',
] as const;

export type PromptAssemblyEndEvent = (typeof PROMPT_ASSEMBLY_END_EVENTS)[number];

export function isAssemblySuccess(event: PromptAssemblyEndEvent): boolean {
  return (
    event === 'E1_PromptAssembledNormal' ||
    event === 'E3_PromptAssembledClarifyMode' ||
    event === 'E4_PromptAssembledMetaMode' ||
    event === 'E10_PromptLogWriteFailed'
  );
}
