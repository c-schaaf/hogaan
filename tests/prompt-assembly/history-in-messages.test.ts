import { describe, expect, it, vi } from 'vitest';
import type * as LibrariesModule from '../../src/libraries/index.js';
import type * as LogModule from '../../src/prompt-assembly/log.js';
import { assemblePrompt } from '../../src/prompt-assembly/assembler.js';
import type { InputPayload } from '../../src/prompt-assembly/types.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';
import type { Database } from '../../src/shared/db/client.js';

/**
 * SCRUM — pre-fix, the streaming /api/chat/turn/stream route passed prior
 * turns both via the LLM `messages[]` parameter AND embedded them in the
 * system prompt's "## Recent session context" block. That ~150-token
 * duplication had been documented as "acceptable for now", but the audit
 * flagged it as a likely contributor to the model's mid-conversation
 * confusion on continued sessions.
 *
 * The fix: assemblePrompt now respects an `historyInMessages` flag on the
 * input payload. When true, the session-context block is omitted from the
 * assembled system prompt. Default behavior (legacy non-streaming callers)
 * is unchanged.
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

function payload(overrides: Partial<InputPayload> = {}): InputPayload {
  return {
    responseMode: 'FullCoachingResponse',
    userMessage: 'continuing our conversation',
    userProfile: { experienceBand: '5-10' },
    retrievedMemories: [],
    sessionTurns: [
      {
        userMessage: 'A_USER_TURN_MARKER',
        responseText: 'A_ASSISTANT_TURN_MARKER',
      },
    ],
    ...overrides,
  };
}

describe('historyInMessages — transcript de-duplication', () => {
  it('default (historyInMessages omitted) embeds the session-context block', async () => {
    const bundle = await assemblePrompt(fakeConfig, fakeDb, payload(), { awaitLogWrite: true });
    expect(bundle.assembledPrompt).toContain('## Recent session context');
    expect(bundle.assembledPrompt).toContain('A_USER_TURN_MARKER');
    expect(bundle.assembledPrompt).toContain('A_ASSISTANT_TURN_MARKER');
  });

  it('historyInMessages:true omits the session-context block entirely', async () => {
    const bundle = await assemblePrompt(fakeConfig, fakeDb, payload({ historyInMessages: true }), {
      awaitLogWrite: true,
    });
    expect(bundle.assembledPrompt).not.toContain('## Recent session context');
    expect(bundle.assembledPrompt).not.toContain('A_USER_TURN_MARKER');
    expect(bundle.assembledPrompt).not.toContain('A_ASSISTANT_TURN_MARKER');
  });

  it('the omitted block leaves no double-blank-line gap in the assembled prompt', async () => {
    const bundle = await assemblePrompt(fakeConfig, fakeDb, payload({ historyInMessages: true }), {
      awaitLogWrite: true,
    });
    // Canonical block separator is exactly one blank line ("\n\n"). Four
    // newlines in a row would mean we accidentally joined an empty block.
    expect(bundle.assembledPrompt).not.toMatch(/\n\n\n\n/);
  });
});
