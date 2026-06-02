import { describe, expect, it, vi } from 'vitest';
import { assemblePrompt } from '../../src/prompt-assembly/assembler.js';
import { buildUserProfileBlock } from '../../src/prompt-assembly/blocks.js';
import type { InputPayload } from '../../src/prompt-assembly/types.js';
import type * as LibrariesModule from '../../src/libraries/index.js';
import type * as LogModule from '../../src/prompt-assembly/log.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';
import type { Database } from '../../src/shared/db/client.js';

/**
 * Hard rule #3 — no PII beyond firstName reaches LLM providers, and per the
 * stricter Phase-9 reading codified in buildUserProfileBlock, even firstName
 * is omitted from the prompt. These tests fail if a future PR re-introduces
 * an interpolation of profile.firstName into any block path (or otherwise
 * leaks email-shaped substrings into the assembled prompt).
 *
 * The canary value "Hamse-CANARY" is deliberately not a normal first name —
 * if it appears anywhere in the assembled prompt the only possible source is
 * profile.firstName, which is the regression we want to catch.
 */

vi.mock('../../src/libraries/index.js', async () => {
  const actual = await vi.importActual<typeof LibrariesModule>('../../src/libraries/index.js');
  return {
    ...actual,
    getActiveLibraryVersions: vi.fn(() =>
      Promise.resolve({
        promptTemplates: {
          version: 'test',
          hash: 'h_pt',
          payload: {
            templates: [
              {
                id: 'coaching_v3_leadership',
                responseMode: 'FullCoachingResponse',
                tokenBudget: 0,
                systemText: 'You are Hogaan. (test unified template)',
              },
            ],
            practiceFraming: [],
            levelFraming: [],
          },
        },
        voiceRules: {
          version: 'test',
          hash: 'h_vr',
          payload: { rules: [], heroPhraseFlags: [], usefulToSocietyPatterns: [] },
        },
        culturalFraming: {
          version: 'test',
          hash: 'h_cf',
          payload: { framings: [] },
        },
        resolvedAt: new Date('2026-05-18T00:00:00Z'),
      }),
    ),
  };
});

vi.mock('../../src/prompt-assembly/log.js', async () => {
  const actual = await vi.importActual<typeof LogModule>('../../src/prompt-assembly/log.js');
  return {
    ...actual,
    writePromptLog: vi.fn(() => Promise.resolve({ success: true })),
  };
});

const fakeConfig = {} as AppConfig;
const fakeDb = {} as Database;

const USER_MESSAGE = 'what should I say about layoffs';

function buildPayload(): InputPayload {
  return {
    responseMode: 'FullCoachingResponse',
    userMessage: USER_MESSAGE,
    userProfile: {
      firstName: 'Hamse-CANARY',
      experienceBand: '5-10',
      role: 'Founder',
      mappedPractices: ['integrity', 'empathy'],
    },
    retrievedMemories: [],
    sessionTurns: [],
  };
}

describe('prompt-assembly — PII discipline (hard rule #3)', () => {
  it('assemblePrompt does not leak profile.firstName into the assembled prompt', async () => {
    const bundle = await assemblePrompt(fakeConfig, fakeDb, buildPayload(), {
      awaitLogWrite: true,
    });

    expect(bundle.assembledPrompt).not.toContain('Hamse-CANARY');
    expect(bundle.assembledPrompt).not.toMatch(/@/);

    // The user's typed message is the only user-authored content that
    // should reach the model. Asserting its presence pins the contract
    // that the userMessage block is built from userMessage alone (not
    // concatenated with profile fields).
    expect(bundle.assembledPrompt).toContain(`## Current user message\n${USER_MESSAGE}`);
  });

  it('buildUserProfileBlock does not interpolate firstName into the returned block string', () => {
    const block = buildUserProfileBlock({
      firstName: 'Hamse-CANARY',
      experienceBand: '5-10',
      role: 'Founder',
      mappedPractices: ['integrity', 'empathy'],
    });

    expect(block).not.toContain('Hamse-CANARY');
  });
});
