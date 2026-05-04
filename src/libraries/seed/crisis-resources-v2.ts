import type { CrisisResourcesPayload } from '../types.js';

/**
 * crisis_resources v2 — Tabaha phone number confirmed by ops on 2026-05-04.
 * Replaces the v1 placeholder (`+252-tbd`) with the live number.
 *
 * v1 stays in `library_versions` as historical (active=false). v2 becomes
 * active. Process #2 Step 1 + Process #10 Check 8 will resolve this version
 * for crisis routing once published.
 *
 * Phase 2 expansion (PRD §10 R3) — geo-aware variants for Hargeisa, diaspora —
 * still deferred. v2 only narrows the existing single Somalia entry.
 */
export const crisisResourcesV2: CrisisResourcesPayload = {
  resources: [
    {
      name: 'Tabaha',
      region: 'somalia',
      channels: [
        {
          kind: 'phone',
          value: '+254722178177',
          note: 'Tabaha mental-health helpline. Confirmed by ops 2026-05-04.',
        },
      ],
      whenToRoute:
        'Any user located in Somalia or the broader Horn of Africa region who signals self-harm, abuse, or imminent danger.',
    },
    {
      name: 'Befrienders Worldwide',
      region: 'global',
      channels: [
        {
          kind: 'web',
          value: 'https://befrienders.org/find-support-now',
          note: 'Global directory — finds the local crisis line by country.',
        },
      ],
      whenToRoute:
        'Diaspora users, or any user where the geo-specific Somalia resource is not appropriate. Always offered alongside the geo-specific resource — never as a substitute.',
    },
  ],

  holdingMessage:
    "I hear you. What you're describing matters, and you deserve real support — more than I can give. I'm sharing two ways to reach a person who can help right now. Please reach out. I'll be here when you come back.",

  todoPhase2Expansion:
    'Phase 2 (PRD §10 R3): geo-aware variants for Hargeisa, Mogadishu, "Other"/diaspora. Add SMS short-codes once a partner is identified.',
};
