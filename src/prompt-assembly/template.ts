import type { PromptTemplatesPayload } from '../libraries/index.js';
import type { ResponseMode } from '../shared/types/index.js';
import { PromptAssemblyError } from './types.js';

/**
 * Process #9 §3 system-template selection. Pure DMN lookup over responseMode.
 * Throws PromptAssemblyError(E8) when the active prompt_templates library
 * doesn't carry a template for the requested mode.
 */
export function selectSystemTemplate(
  templates: PromptTemplatesPayload,
  responseMode: ResponseMode,
): { id: string; systemText: string; tokenBudget: number } {
  const found = templates.templates.find((t) => t.responseMode === responseMode);
  if (found === undefined) {
    throw new PromptAssemblyError(
      `no system template for responseMode=${responseMode} in active prompt_templates library`,
      'E8_TemplateMissing',
    );
  }
  return { id: found.id, systemText: found.systemText, tokenBudget: found.tokenBudget };
}
