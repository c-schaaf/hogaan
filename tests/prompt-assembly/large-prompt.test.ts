import { describe, expect, it, vi } from 'vitest';
import type * as LibrariesModule from '../../src/libraries/index.js';
import type * as LogModule from '../../src/prompt-assembly/log.js';
import { assemblePrompt } from '../../src/prompt-assembly/assembler.js';
import type { InputPayload } from '../../src/prompt-assembly/types.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';
import type { Database } from '../../src/shared/db/client.js';

/**
 * SCRUM-55 regression lock — assembling a ~50k-token prompt must succeed,
 * land on E1_PromptAssembledNormal, and carry no degradation flags. Before
 * SCRUM-55, anything above ~4000 estimated tokens tripped the budget cascade
 * and (above ~6000-ish) threw E9_PromptOversize, which mapped to a templated
 * "Something went wrong on my side just now" fallback in the orchestrator.
 *
 * If a future refactor reintroduces a hard cap on prompt size, this test
 * must fail. It mocks `getActiveLibraryVersions` (returns coaching_v0_unified
 * so the assembler skips practice/level/voice/cultural blocks) and
 * `writePromptLog` (no-ops the DB write).
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
                id: 'coaching_v0_unified',
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

function buildLargePayload(): InputPayload {
  // Target ~50k estimated tokens. estimator = chars / 3.5 → need ~175k chars.
  // Notes for fixture stability:
  //   - buildMemoryBlock caps at 10 entries (oldest dropped). Inflate each
  //     entry rather than adding more entries.
  //   - buildSessionContext keeps all turns. 25 turns × ~7000 chars each
  //     pulls its weight without hitting any cap.
  const memoryLine =
    'User reflected at length on a hard delivery conversation with their COO, the cultural texture of the moment, and the leadership questions left unresolved. ';
  const memories = Array.from({ length: 10 }, (_, i) => ({
    // ~150 chars × 60 ≈ 9000 chars per entry × 10 entries ≈ 90k chars.
    content: memoryLine.repeat(60) + ` (memory #${i})`,
    createdAt: new Date(`2026-04-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`),
  }));

  const turnLine =
    'A long-form reflection on practice, role, and the slow shape of leadership growth over months. ';
  // ~95 chars × 40 ≈ 3800 chars per user msg + per assistant msg.
  // 12 turns × (~3800 + ~3800) ≈ 90k chars across user + assistant.
  const sessionTurns = Array.from({ length: 12 }, (_, i) => ({
    userMessage: turnLine.repeat(40) + ` (user turn #${i})`,
    responseText: turnLine.repeat(40) + ` (assistant turn #${i})`,
  }));

  return {
    responseMode: 'FullCoachingResponse',
    userMessage: 'I want to keep going with what we were talking about yesterday.',
    userProfile: {
      firstName: 'Hamse',
      role: 'Founder',
      location: 'Mogadishu',
    },
    retrievedMemories: memories,
    sessionTurns,
  };
}

describe('SCRUM-55 — large prompts assemble without a token-budget cap', () => {
  it('assembles a ~50k-token prompt successfully with no degradation flags', async () => {
    const payload = buildLargePayload();
    const bundle = await assemblePrompt(fakeConfig, fakeDb, payload, { awaitLogWrite: true });

    // Sanity-check we actually built something in the 50k-token range — if the
    // fixture drifts much smaller this test stops proving what it claims.
    expect(bundle.tokenCount).toBeGreaterThan(40_000);

    // E1 is the canonical success terminal for FullCoachingResponse now that
    // E2_PromptAssembledWithDegradation was removed alongside the budget.
    expect(bundle.endEvent).toBe('E1_PromptAssembledNormal');

    // No flag should ever be set from prompt-assembly post-SCRUM-55. The
    // orchestrator may set `fallbackModelUsed` / `contextFetchPartial`
    // downstream, but the assembler itself returns the all-false default.
    expect(bundle.degradationFlags.memoryTruncated).toBe(false);
    expect(bundle.degradationFlags.sessionTruncated).toBe(false);
    expect(bundle.degradationFlags.culturalFramingDropped).toBe(false);

    // The full prompt text should round-trip the bulk of the input — no
    // truncation cascade trimmed half of memory or chopped session turns.
    expect(bundle.assembledPrompt.length).toBeGreaterThan(150_000);
  });
});
