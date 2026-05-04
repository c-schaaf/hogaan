/**
 * Process #11 Step 5 — template catalog validation.
 *
 * Twilio + Meta require all out-of-window outbound messages to use pre-approved
 * templates. The catalog defines what templates the +254 sender (and the
 * sandbox) is allowed to send: the template's friendly name, the number of
 * substitution slots, and a per-slot character limit.
 *
 * For Phase 3 the catalog ships hardcoded — Twilio template approval is on a
 * separate operational track. Phase 6/7/8 will introduce real templates
 * (welcome, daily prompt, re-engagement, crisis holding) once approved.
 *
 * Phase 9 may move this catalog to library_versions if template content
 * starts requiring per-environment overrides.
 */

export interface TemplateSpec {
  name: string;
  /** Number of {{1}}…{{N}} substitution slots in the body. */
  slotCount: number;
  /** Inclusive max length for any substituted slot. */
  perSlotMaxLen: number;
  /** Whether this template is currently active in Meta. */
  active: boolean;
}

const CATALOG: Record<string, TemplateSpec> = {
  // Sandbox echo template — Twilio's default sandbox-approved template that
  // accepts a single body parameter. Used by scripts/send-test-message.ts.
  sandbox_echo: {
    name: 'sandbox_echo',
    slotCount: 1,
    perSlotMaxLen: 1000,
    active: true,
  },
};

export type TemplateValidationResult =
  | { ok: true; spec: TemplateSpec }
  | { ok: false; reason: 'not_found' | 'inactive' | 'param_count' | 'param_length' };

export function validateTemplate(
  name: string,
  params: string[] | undefined,
): TemplateValidationResult {
  const spec = CATALOG[name];
  if (spec === undefined) {
    return { ok: false, reason: 'not_found' };
  }
  if (!spec.active) {
    return { ok: false, reason: 'inactive' };
  }
  const ps = params ?? [];
  if (ps.length !== spec.slotCount) {
    return { ok: false, reason: 'param_count' };
  }
  for (const p of ps) {
    if (p.length > spec.perSlotMaxLen) {
      return { ok: false, reason: 'param_length' };
    }
  }
  return { ok: true, spec };
}

/** Test seam — exposed so tests can extend without mutating the live module. */
export function _registerTemplateForTests(spec: TemplateSpec): void {
  CATALOG[spec.name] = spec;
}
