import type { CulturalFramingPayload } from '../types.js';
import { culturalFramingV1 } from './cultural-framing.js';

/**
 * cultural_framing **v2 DRAFT** — Phase 11 R40.
 *
 * **STATUS: NOT PUBLISHED.** This file is the engineering scaffolding for
 * the v2 library; it MUST NOT be loaded by the live library resolver until
 * Hamse signs off on the new framing's example_phrasings. CLAUDE.md hard
 * rule #3 (libraries are Hamse-owned) applies.
 *
 * Diff from v1 (15 → 16 concepts):
 *   + Framing #16: **Xil** — duty/obligation that comes with role.
 *
 * Why this framing:
 *   The audit found that v1 over-indexes on relational concepts (Tol, Hooyo,
 *   Naxariis, Maslaxad) without a counterweight that names the *obligation*
 *   role-holders carry. "Xil" sits at that pole: the duty that comes with
 *   leading, the responsibility you took on the day you accepted authority.
 *   Pairs naturally with Sharaf (honor) and Wadanjirka (civic duty), but
 *   distinct from both — Xil is the role-specific debt, not honor or
 *   citizenship.
 *
 * Open items before publish (Hamse to provide):
 *   - Final example_phrasings — at least one Mogadishu-grounded, one
 *     Hargeisa-grounded if the concept's usage differs across regions.
 *   - Confirmation of the gloss; is "duty/obligation that comes with role"
 *     the right framing in English, or should it be closer to "trust given,
 *     debt owed"?
 *
 * Promotion path: once Hamse signs off, libraryActivation will be updated
 * to point cultural_framing.activeVersion at v2; this file's payload then
 * becomes canonical and replaces the export in cultural-framing.ts. Until
 * then, the live library resolver continues to use v1.
 */

export const culturalFramingV2Draft: CulturalFramingPayload = {
  framings: [
    ...culturalFramingV1.framings,
    {
      concept: 'Xil',
      gloss: 'duty/obligation that comes with role',
      shortDescription:
        'Xil is the weight a role places on you — not honor (Sharaf), not citizenship (Wadanjirka), but the specific debt incurred by accepting authority. A leader who carries Xil knows that the role asked something of them before they asked anything of it.',
      applicableWhen: [
        'User accepted a promotion or new responsibility and is feeling the weight of it.',
        'User is debating whether to step away from a hard call that is rightfully theirs.',
        'User is delegating something they should be doing personally.',
        'User is conflating popularity with discharging their role.',
      ],
      examplePhrasings: [
        // TODO(Hamse): final example_phrasings. Drafts below for review —
        // please reject/rewrite per voice. The intent is to capture the
        // role-debt-not-honor distinction.
        '[DRAFT — Hamse to confirm] Xil asks the quiet question: what did the role ask of you that you have not yet given?',
        '[DRAFT — Hamse to confirm] Sharaf is what others give you. Xil is what the role takes from you. They are not the same thing.',
      ],
    },
  ],
};

/**
 * Test-only re-export of just the new framing for unit assertions.
 */
export const _XIL_FRAMING_DRAFT = culturalFramingV2Draft.framings[15]!;
