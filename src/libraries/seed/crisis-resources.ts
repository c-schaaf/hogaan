import type { CrisisResourcesPayload } from '../types.js';

/**
 * crisis_resources v1 — minimal MVP per user decision.
 *
 * Hardcoded to Tabaha (Somalia mental-health helpline, named in PRD glossary)
 * and Befrienders Worldwide (befrienders.org global fallback). Phase 2 expansion
 * (PRD §10 R3) adds geo-aware variants for Hargeisa, diaspora regions, etc.
 *
 * **Crisis routing supersedes everything (CLAUDE.md hard rule #1).** Process #2
 * Step 1 and Process #10 Check 8 both invoke this resource list when a crisis
 * is detected. False positives are acceptable; false negatives are catastrophic.
 *
 * Status: needs Hamse + counsel sign-off before Phase A launch (PRD plan
 * open-question §3 — RESOLVED for v1, expansion deferred).
 */
export const crisisResourcesV1: CrisisResourcesPayload = {
  resources: [
    {
      name: 'Tabaha',
      region: 'somalia',
      channels: [
        {
          kind: 'phone',
          value: '+252-tbd',
          note: 'Tabaha mental-health helpline (Somalia). Phone number to be confirmed by ops before Phase A launch — placeholder kept so the routing wiring exists.',
        },
      ],
      whenToRoute: 'Any user located in Somalia who signals self-harm, abuse, or imminent danger.',
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
    'Phase 2 (PRD §10 R3): geo-aware variants for Hargeisa, Mogadishu, "Other"/diaspora. Add SMS short-codes once a partner is identified. Confirm Tabaha phone number with ops.',
};
