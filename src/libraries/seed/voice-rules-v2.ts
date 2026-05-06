import type { VoiceRulesPayload } from '../types.js';
import { voiceRulesV1 } from './voice-rules.js';

/**
 * voice_rules **v2 DRAFT** — Phase 11 R39.
 *
 * **STATUS: NOT PUBLISHED.** This file is the engineering scaffolding for
 * the v2 library; it MUST NOT be loaded by the live library resolver until
 * Hamse signs off on the new rule's positive/negative examples. CLAUDE.md
 * hard rule #3 (libraries are Hamse-owned) applies.
 *
 * Diff from v1 (10 → 11 rules):
 *   + Rule 11: **Formatting discipline.**
 *
 * Why this rule:
 *   The audit found that responses were drifting toward over-formatted,
 *   markdown-heavy output: ##-style headers, multiple bold phrases, bullet
 *   lists. WhatsApp renders these as literal characters, not formatting —
 *   and even where it does honor *bold*, the visual noise undermines the
 *   "warm and pragmatic" voice. Rule 11 codifies the discipline:
 *
 *     - Zero markdown headers (#, ##, ###).
 *     - At most ONE *bold* segment per response (the key insight).
 *     - No bullet lists. Sentences and paragraphs only.
 *     - WhatsApp-native formatting only.
 *
 * The matching rule-based check sits in src/quality-check/checks-rule-based.ts
 * (checkFormattingDiscipline) and runs against every FullCoachingResponse.
 * It is the *runtime* enforcement; this rule is the *content* statement that
 * the LLM sees in the system prompt and that the QC's voice-consistency check
 * (R15) treats as authoritative.
 *
 * Open items before publish (Hamse to provide):
 *   - Final positiveExamples + negativeExamples in his voice.
 *   - Confirmation of the "at most ONE bold" cap (vs. e.g. up to 2).
 *
 * Promotion path: same as v1 — once Hamse signs off, libraryActivation
 * is updated to point voice_rules.activeVersion at v2, and this payload
 * replaces the export in voice-rules.ts.
 */

export const voiceRulesV2Draft: VoiceRulesPayload = {
  ...voiceRulesV1,
  rules: [
    ...voiceRulesV1.rules,
    {
      id: 'r11-formatting-discipline',
      title: 'Formatting discipline (WhatsApp-native, low markdown)',
      description:
        'Responses ship into WhatsApp, where markdown headers render as literal "##". Use WhatsApp-native formatting only: at most ONE *bold* segment per response (reserved for the key insight), zero markdown headers, zero bullet lists. Paragraphs do the work. Visual restraint reinforces the "warm and pragmatic" voice — a coaching presence, not a slide deck.',
      whenToApply:
        'Every FullCoachingResponse. ClarifyingQuestion and MetaResponse are already short enough that the rule is moot but still applies.',
      positiveExamples: [
        // TODO(Hamse): final examples in your voice. Drafts below for review.
        '[DRAFT — Hamse to confirm] "Your sleeplessness is integrity working. *That is the leadership instinct talking.* The next move is to name what your team needs from you in the next 48 hours."',
      ],
      negativeExamples: [
        // TODO(Hamse): final examples. Drafts below capture the failure modes.
        '[DRAFT — Hamse to confirm] "## Diagnosis\\n**Issue 1**: …\\n**Issue 2**: …\\n- Bullet point\\n- Bullet point" — markdown headers + multiple bolds + bullets, all three failures at once.',
        '[DRAFT — Hamse to confirm] "**You are doing good work.** **The team needs you.** **Lean in.**" — three bolds, no insight load on any of them.',
      ],
    },
  ],
};

/** Test seam — direct access to the new rule for unit assertions. */
export const _R11_FORMATTING_DRAFT = voiceRulesV2Draft.rules[10]!;
