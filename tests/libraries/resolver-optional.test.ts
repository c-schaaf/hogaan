import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  getActiveLibraryVersions,
  LibraryResolverError,
  resetResolverForTests,
} from '../../src/libraries/resolver.js';

/**
 * SCRUM (PR 6, launch-readiness D-8 / audit #16) — the resolver used to
 * hard-require all 5 libraries (prompt_templates / voice_rules /
 * cultural_framing / crisis_resources / scenarios). A missing seed on any
 * one of them killed every chat with an opaque E6_LibraryUnavailable.
 *
 * Post-fix, only `prompt_templates` is load-bearing. Missing optional
 * libraries log a P2 and fall back to an empty payload. The resolved
 * bundle's `voiceRules` / `culturalFraming` / etc. carry `version='absent'`
 * so downstream callers can detect the synthetic fallback if needed.
 */

const PT_ROW = {
  libraryName: 'prompt_templates' as const,
  version: 'v3_leadership_tune1',
  payload: {
    templates: [
      {
        id: 'coaching_v3_leadership',
        responseMode: 'FullCoachingResponse',
        tokenBudget: 4000,
        systemText: 'You are Hogaan.',
      },
    ],
    practiceFraming: [],
    levelFraming: [],
  },
  hash: 'pt-hash',
};

function makeDb(rows: Array<Record<string, unknown>>) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  } as never;
}

describe('getActiveLibraryVersions — optional libraries (PR 6 D-8)', () => {
  beforeEach(() => {
    resetResolverForTests();
  });

  it('succeeds when only prompt_templates is present (other 4 missing)', async () => {
    const resolved = await getActiveLibraryVersions(makeDb([PT_ROW]));
    expect(resolved.promptTemplates.version).toBe('v3_leadership_tune1');
    // Missing libraries synthesize as version='absent' + empty payload.
    expect(resolved.voiceRules.version).toBe('absent');
    expect(resolved.culturalFraming.version).toBe('absent');
    expect(resolved.crisisResources.version).toBe('absent');
    expect(resolved.scenarios.version).toBe('absent');
  });

  it('still throws if prompt_templates itself is missing', async () => {
    await expect(getActiveLibraryVersions(makeDb([]))).rejects.toBeInstanceOf(LibraryResolverError);
  });

  it('uses real library rows when present', async () => {
    const resolved = await getActiveLibraryVersions(
      makeDb([
        PT_ROW,
        {
          libraryName: 'voice_rules',
          version: 'v1',
          payload: { rules: [], heroPhraseFlags: [], usefulToSocietyPatterns: [] },
          hash: 'vr-hash',
        },
      ]),
    );
    expect(resolved.voiceRules.version).toBe('v1');
    expect(resolved.voiceRules.hash).toBe('vr-hash');
    // The other 3 still absent — synthetic.
    expect(resolved.culturalFraming.version).toBe('absent');
  });

  void vi;
});
