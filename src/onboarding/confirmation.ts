import { eq } from 'drizzle-orm';
import { getActiveLibraryVersions } from '../libraries/index.js';
import { assemblePrompt } from '../prompt-assembly/index.js';
import { runQualityCheck } from '../quality-check/index.js';
import type { Database } from '../shared/db/client.js';
import { anthropicChat } from '../shared/llm/anthropic.js';
import { LlmError } from '../shared/llm/errors.js';
import { reportP1 } from '../incident-handling/index.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { UserId } from '../shared/types/index.js';
import { users } from '../shared/db/schema/users.js';

/**
 * Process #1 §8 confirmation flow: assemble prompt → call Anthropic → QC →
 * return approved (or templated-fallback) text. Caller dispatches via
 * Process #11.
 *
 * The "user message" in this assembly is a synthesized profile snapshot —
 * not anything the user typed. Mode=ProfileUpdateAcknowledgment means the
 * prompt template is profile_ack_v1 (~150 tokens).
 */

const CONFIRM_TIMEOUT_MS = 10_000;
const CONFIRM_MAX_TOKENS = 256;

export interface ConfirmationOptions {
  config: AppConfig;
  db: Database;
  userId: UserId;
}

export interface ConfirmationResult {
  text: string;
  /** True when LLM/QC failed and we returned a templated fallback. */
  fallbackUsed: boolean;
  /** Diagnostic — where the fallback was triggered, when applicable. */
  fallbackReason?: 'llm_error' | 'qc_not_approved' | 'no_active_library';
}

export async function generateConfirmation(opts: ConfirmationOptions): Promise<ConfirmationResult> {
  // Read the freshly-persisted profile for the prompt context.
  const rows = await opts.db
    .select({
      role: users.role,
      experienceBand: users.experienceBand,
      goals: users.goals,
      location: users.location,
      timezone: users.timezone,
      isDiaspora: users.isDiaspora,
      mappedPractices: users.mappedPractices,
    })
    .from(users)
    .where(eq(users.id, opts.userId))
    .limit(1);

  const profile = rows[0];
  if (profile === undefined) {
    return {
      text: templatedFallback(null),
      fallbackUsed: true,
      fallbackReason: 'no_active_library',
    };
  }

  const synthesized = synthesizeProfileSummary(profile);

  // Step 1: assemble the prompt (mode=ProfileUpdateAcknowledgment).
  let prompt;
  try {
    prompt = await assemblePrompt(opts.config, opts.db, {
      userId: opts.userId,
      responseMode: 'ProfileUpdateAcknowledgment',
      practiceTag: pickPrimaryPractice(profile.mappedPractices),
      levelTag: 'self',
      userMessage: synthesized,
      userProfile: {
        ...(typeof profile.role === 'string' ? { role: profile.role } : {}),
        ...(typeof profile.experienceBand === 'string'
          ? { experienceBand: profile.experienceBand }
          : {}),
        ...(typeof profile.location === 'string' ? { location: profile.location } : {}),
        ...(typeof profile.timezone === 'string' ? { timezone: profile.timezone } : {}),
        ...(typeof profile.isDiaspora === 'boolean' ? { isDiaspora: profile.isDiaspora } : {}),
        ...(Array.isArray(profile.goals) ? { goals: profile.goals as string[] } : {}),
        ...(Array.isArray(profile.mappedPractices)
          ? { mappedPractices: profile.mappedPractices as never }
          : {}),
      },
      retrievedMemories: [],
      sessionTurns: [],
    });
  } catch (err) {
    reportP1(
      'onboarding confirmation prompt assembly failed',
      {
        source: 'Process_1.Step_8.AssemblePrompt',
        extra: { userId: opts.userId },
      },
      err,
    );
    return {
      text: templatedFallback(profile),
      fallbackUsed: true,
      fallbackReason: 'no_active_library',
    };
  }

  // Step 2: LLM call.
  let candidate: string;
  try {
    const llm = await anthropicChat(opts.config, {
      model: 'claude-haiku-4-5',
      systemPrompt: prompt.assembledPrompt,
      messages: [{ role: 'user', content: synthesized }],
      maxTokens: CONFIRM_MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: CONFIRM_TIMEOUT_MS,
    });
    candidate = llm.text.trim();
  } catch (err) {
    reportP1(
      'onboarding confirmation LLM call failed',
      {
        source: 'Process_1.Step_8.LLM',
        extra: { userId: opts.userId, name: err instanceof LlmError ? err.name : 'unknown' },
      },
      err,
    );
    return { text: templatedFallback(profile), fallbackUsed: true, fallbackReason: 'llm_error' };
  }

  // Step 3: QC.
  const libs = await getActiveLibraryVersions(opts.db);
  const qc = await runQualityCheck(
    {
      config: opts.config,
      libraries: libs,
      originalSystemPrompt: prompt.assembledPrompt,
    },
    {
      candidateResponseText: candidate,
      userMessage: synthesized,
      responseMode: 'ProfileUpdateAcknowledgment',
      intent: 'ProfileUpdate',
      predictedPracticeTag: pickPrimaryPractice(profile.mappedPractices),
      predictedLevelTag: 'self',
    },
  );

  if (qc.endEvent === 'E1_ApprovedFirstAttempt' || qc.endEvent === 'E2_ApprovedRegenerated') {
    return { text: qc.responseText, fallbackUsed: false };
  }

  return {
    text: templatedFallback(profile),
    fallbackUsed: true,
    fallbackReason: 'qc_not_approved',
  };
}

// ---------------------------------------------------------------------------

function synthesizeProfileSummary(p: {
  role: string | null;
  goals: unknown;
  location: string | null;
}): string {
  const goals = Array.isArray(p.goals) ? (p.goals as string[]).join(', ') : 'leadership growth';
  const role = p.role ?? 'a professional';
  const loc = p.location ?? 'the place you reach me from';
  return `Profile complete. I'm a ${role} focused on ${goals}, based in ${loc}. Acknowledge what you heard and name how you'll show up for me. Two short paragraphs, brand-aligned, no coaching arc.`;
}

function pickPrimaryPractice(
  mapped: unknown,
):
  | 'integrity'
  | 'purpose'
  | 'accountability'
  | 'dignity'
  | 'empathy'
  | 'inclusion'
  | 'assets'
  | 'innovation'
  | 'prosperity'
  | 'humility'
  | 'democracy'
  | 'peace' {
  if (Array.isArray(mapped) && mapped.length > 0 && typeof mapped[0] === 'string') {
    const valid = [
      'integrity',
      'purpose',
      'accountability',
      'dignity',
      'empathy',
      'inclusion',
      'assets',
      'innovation',
      'prosperity',
      'humility',
      'democracy',
      'peace',
    ] as const;
    const found = valid.find((v) => v === mapped[0]);
    if (found !== undefined) {
      return found;
    }
  }
  return 'integrity';
}

function templatedFallback(
  profile: { role: string | null; goals: unknown; location: string | null } | null,
): string {
  if (profile === null) {
    return `Got it. Profile saved. I'll be here when you message again.`;
  }
  const goals =
    Array.isArray(profile.goals) && profile.goals.length > 0
      ? (profile.goals as string[]).join(', ')
      : 'leadership growth';
  const role = profile.role ?? 'where you are';
  const where = profile.location !== null ? `, reaching me from ${profile.location}` : '';
  return `Got it. You're focused on ${goals}, working as ${role}${where}. I'll show up steady — message me when something is on your mind.`;
}
