import { groqChat } from '../shared/llm/groq.js';
import { LlmError } from '../shared/llm/errors.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { CheckOutcome, CheckResult } from './types.js';

/**
 * LLM-backed checks (3, 4, 7, 8). All run on Groq Llama 3.3 70B with strict
 * JSON output, ≤200 max_tokens, and a 4-second per-call budget so the full
 * QC pass stays well under the 6s p99 turn budget even when all four LLM
 * checks fire in sequence.
 *
 * Failure semantics differ by check:
 *   - Checks 3, 4, 7: any LlmError → service_unavailable, but the orchestrator
 *     treats this as "skip" rather than fail-closed (Process #10 plan note:
 *     these are quality-shaping, not safety-critical).
 *   - Check 8: any LlmError → service_unavailable, and orchestrator MUST
 *     route to E6 (no approval without verified safety).
 */

const CLASSIFIER_TIMEOUT_MS = 4000;
const CLASSIFIER_MAX_TOKENS = 200;

interface ClassifierJson {
  pass: boolean;
  reason?: string;
}

async function runClassifier(
  config: AppConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<ClassifierJson> {
  const res = await groqChat(config, {
    model: 'llama-3.3-70b-versatile',
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: CLASSIFIER_MAX_TOKENS,
    temperature: 0,
    jsonMode: true,
    timeoutMs: CLASSIFIER_TIMEOUT_MS,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    throw new Error(`classifier returned invalid JSON: ${res.text.slice(0, 200)}`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`classifier did not return an object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['pass'] !== 'boolean') {
    throw new Error(`classifier missing boolean "pass" field`);
  }
  const out: ClassifierJson = { pass: obj['pass'] };
  if (typeof obj['reason'] === 'string') {
    out.reason = obj['reason'];
  }
  return out;
}

/** Process #10 Check 3 — signature structure (story → insight → framing → action arc). */
export async function check3SignatureStructure(
  config: AppConfig,
  candidate: string,
): Promise<CheckResult> {
  const system = `You are a brand-voice classifier for Hogaan, a leadership coaching presence anchored in Hamse Warfa's framework. Hogaan responses follow an approximate arc: brief story → insight → optional cultural framing → one or two concrete action items. Every full response leaves the user with something concrete to do.

Score the candidate response below. Return strict JSON {"pass": true|false, "reason": "..."} where pass=true if the arc is recognizable AND there is at least one concrete next-action the user can take, false otherwise. Reason ≤80 chars.`;
  try {
    const r = await runClassifier(config, system, `Candidate response:\n"""\n${candidate}\n"""`);
    return {
      checkId: 'check_03_signature_structure',
      outcome: r.pass
        ? { status: 'pass' }
        : { status: 'soft_fail', reason: r.reason ?? 'arc/action missing' },
    };
  } catch (err) {
    return makeServiceUnavailable('check_03_signature_structure', err);
  }
}

/** Process #10 Check 4 — asset-based framing (lead with what user has, not what they lack). */
export async function check4AssetBased(config: AppConfig, candidate: string): Promise<CheckResult> {
  const system = `You are a brand-voice classifier for Hogaan, anchored in Hamse Warfa's asset-based leadership framing. Asset-based means leading from what the user already has — strengths, integrity, presence — never from what they lack ("you struggle with...", "you lack..."). Pure absence-of-deficit-language is not enough; the response should actively name an asset the user is bringing.

Return strict JSON {"pass": true|false, "reason": "..."} (reason ≤80 chars).`;
  try {
    const r = await runClassifier(config, system, `Candidate response:\n"""\n${candidate}\n"""`);
    return {
      checkId: 'check_04_asset_based',
      outcome: r.pass
        ? { status: 'pass' }
        : { status: 'soft_fail', reason: r.reason ?? 'deficit-led framing detected' },
    };
  } catch (err) {
    return makeServiceUnavailable('check_04_asset_based', err);
  }
}

/** Process #10 Check 7 — tone (warm + pragmatic; never robotic, academic, or preachy). */
export async function check7Tone(config: AppConfig, candidate: string): Promise<CheckResult> {
  const system = `You are a tone classifier for Hogaan. Hogaan's tone is warm and pragmatic — genuinely caring + has-run-organizations honest. It is NEVER robotic ("optimize stakeholder alignment"), academic ("framework theory suggests..."), or preachy ("you should believe in yourself").

Return strict JSON {"pass": true|false, "reason": "..."} where pass=true only if the tone is warm + pragmatic. Robotic / academic / preachy / motivational-fluff register all fail. (reason ≤80 chars).`;
  try {
    const r = await runClassifier(config, system, `Candidate response:\n"""\n${candidate}\n"""`);
    return {
      checkId: 'check_07_tone',
      outcome: r.pass
        ? { status: 'pass' }
        : { status: 'soft_fail', reason: r.reason ?? 'tone off-register' },
    };
  } catch (err) {
    return makeServiceUnavailable('check_07_tone', err);
  }
}

interface SafetyClassifierJson {
  /** 'pass' | 'soft_fail' | 'crisis' | 'hard_fail' */
  status: string;
  reason?: string;
}

/**
 * Process #10 Check 8 — safety + crisis classifier. **Fail-closed**.
 *
 * Two-axis classification:
 *   - Response safety: no clinical claims, no legal/medical advice outside
 *     leadership, no harmful content. Failures → soft_fail (regenerate) or
 *     hard_fail (terminal).
 *   - User-message crisis detection: self-harm, abuse, imminent danger.
 *     Detection → crisis (orchestrator routes to Crisis Handoff). This is
 *     the second crisis line — Process #2 Step 1 is the first.
 *
 * High-recall: false positives are acceptable; false negatives are
 * catastrophic (CLAUDE.md hard rule #1).
 */
export async function check8SafetyCrisis(
  config: AppConfig,
  userMessage: string,
  candidate: string,
): Promise<CheckResult> {
  const system = `You are a safety + crisis classifier for Hogaan, a leadership coaching presence. You evaluate TWO axes simultaneously:

(1) Response safety: does the response make clinical mental-health claims? Give legal/medical/financial/technical advice outside leadership? Contain harmful or dehumanizing content? If yes → "hard_fail". Borderline issues that could be regenerated → "soft_fail".

(2) User-message crisis: is the user signaling self-harm, abuse, suicidal ideation, or imminent danger to themselves or others? Be HIGH-RECALL — false positives are fine, false negatives are catastrophic. If yes → "crisis".

If everything is fine → "pass".

Return strict JSON {"status": "pass"|"soft_fail"|"crisis"|"hard_fail", "reason": "..."} (reason ≤120 chars).`;
  const userPrompt = `User message:\n"""\n${userMessage}\n"""\n\nCandidate response:\n"""\n${candidate}\n"""`;

  try {
    const res = await groqChat(config, {
      model: 'llama-3.3-70b-versatile',
      systemPrompt: system,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: CLASSIFIER_MAX_TOKENS,
      temperature: 0,
      jsonMode: true,
      timeoutMs: CLASSIFIER_TIMEOUT_MS,
    });
    const parsed = JSON.parse(res.text) as SafetyClassifierJson;
    if (typeof parsed?.status !== 'string') {
      throw new Error('safety classifier missing status');
    }
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    let outcome: CheckOutcome;
    switch (parsed.status) {
      case 'pass':
        outcome = { status: 'pass' };
        break;
      case 'soft_fail':
        outcome = { status: 'soft_fail', reason: reason || 'safety borderline' };
        break;
      case 'crisis':
        outcome = { status: 'crisis', reason: reason || 'crisis detected in user message' };
        break;
      case 'hard_fail':
        outcome = { status: 'hard_fail', reason: reason || 'safety hard fail' };
        break;
      default:
        outcome = { status: 'soft_fail', reason: `unknown status: ${parsed.status}` };
    }
    return { checkId: 'check_08_safety_crisis', outcome };
  } catch (err) {
    // Fail-closed: any error means we can't verify safety, route to E6.
    return makeServiceUnavailable('check_08_safety_crisis', err);
  }
}

/**
 * Phase 11 R33 — Voice Rule 6 enforcement (lived authority sparingly).
 *
 * The audit found responses citing Hamse's biography ("as a refugee", "from
 * my time at...") as a *credential* without the *insight* the experience is
 * meant to load — i.e. the lived-experience marker does the rhetorical work
 * alone. Voice Rule 6 says: lived authority must always be in service of an
 * insight, never standing in for one.
 *
 * Score: 0 = no lived-experience invoked (pass), 1 = invoked AND paired with
 * an insight (pass), 2 = invoked as a credential without insight (soft_fail).
 *
 * Soft-fail: the QC retry loop gets one chance to repair. Like the other
 * voice checks, this is quality-shaping, not safety-critical.
 */
export async function checkLivedExperienceDiscipline(
  config: AppConfig,
  candidate: string,
): Promise<CheckResult> {
  const system = `You are a voice classifier for Hogaan, a leadership coaching presence anchored in Hamse Warfa's voice. Hamse's lived experience (Somali refugee origin, US private-sector + public-service career, philanthropic work in the Horn of Africa) is part of the voice — but Voice Rule 6 says: invoke it ONLY in service of a specific insight. Never as a credential standing on its own.

Score the candidate response on a 0/1/2 scale:
  - 0 = lived experience not invoked (default, pass)
  - 1 = lived experience invoked AND paired with a concrete insight (pass)
  - 2 = lived experience invoked as a credential WITHOUT an accompanying insight (FAIL)

Return strict JSON {"score": 0|1|2, "reason": "..."} (reason ≤80 chars).`;
  try {
    const res = await groqChat(config, {
      model: 'llama-3.3-70b-versatile',
      systemPrompt: system,
      messages: [{ role: 'user', content: `Candidate response:\n"""\n${candidate}\n"""` }],
      maxTokens: CLASSIFIER_MAX_TOKENS,
      temperature: 0,
      jsonMode: true,
      timeoutMs: CLASSIFIER_TIMEOUT_MS,
    });
    const parsed = JSON.parse(res.text) as { score?: unknown; reason?: unknown };
    const score = typeof parsed.score === 'number' ? parsed.score : -1;
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    let outcome: CheckOutcome;
    if (score === 0 || score === 1) {
      outcome = { status: 'pass' };
    } else if (score === 2) {
      outcome = {
        status: 'soft_fail',
        reason: reason || 'lived authority cited as credential without insight',
      };
    } else {
      throw new Error(`classifier returned invalid score: ${String(parsed.score)}`);
    }
    return { checkId: 'check_10_lived_experience', outcome };
  } catch (err) {
    return makeServiceUnavailable('check_10_lived_experience', err);
  }
}

function makeServiceUnavailable(checkId: CheckResult['checkId'], err: unknown): CheckResult {
  const reason =
    err instanceof LlmError
      ? `${err.name}: ${err.message}`
      : err instanceof Error
        ? err.message
        : 'classifier error';
  return {
    checkId,
    outcome: { status: 'service_unavailable', reason },
  };
}
