import { groqChat } from '../shared/llm/groq.js';
import { classifierChat } from '../shared/llm/classifier.js';
import { LlmError } from '../shared/llm/errors.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { PracticeTag } from '../shared/types/index.js';
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

/**
 * Phase 11 R34 — tangible-action requirement.
 *
 * The audit found coaching responses that hit the structural arc (story →
 * insight → framing → action) but the "action" was rhetorical filler — "lean
 * into it", "trust yourself", "be open" — with no concrete next-step the user
 * could actually execute. Voice Rule 3 wants the action to be specific enough
 * that the user could put it on a calendar.
 *
 * Distinct from Check 3 (signature_structure): structure-3 verifies the
 * shape of the arc; this check verifies the *content* of the action slot
 * is concrete (a meeting to hold, a question to ask, a sentence to say).
 */
export async function checkTangibleAction(
  config: AppConfig,
  candidate: string,
): Promise<CheckResult> {
  const system = `You are a brand-voice classifier for Hogaan, a leadership coaching presence anchored in Hamse Warfa's "twelve practices" framework. Hogaan responses must end with a CONCRETE next-step the user could execute today or this week — a specific meeting to hold, a sentence to say, a question to ask, a person to talk to. Vague exhortations ("lean into it", "trust the process", "be open", "believe in yourself") fail this check.

Score the candidate response: pass=true if there is at least one concrete, specific next-action; pass=false if the response ends without one OR only ends with rhetorical filler.

Return strict JSON {"pass": true|false, "reason": "..."} (reason ≤80 chars).`;
  try {
    const r = await runClassifier(config, system, `Candidate response:\n"""\n${candidate}\n"""`);
    return {
      checkId: 'check_12_tangible_action',
      outcome: r.pass
        ? { status: 'pass' }
        : { status: 'soft_fail', reason: r.reason ?? 'no concrete next-step found' },
    };
  } catch (err) {
    return makeServiceUnavailable('check_12_tangible_action', err);
  }
}

/**
 * Phase 12 R4 — Voice Rule 1 intentionality check.
 *
 * The rule-based usefulToSocietyPatterns (R4-tightened) catches phrasal
 * anchors. This LLM check is the second line: it asks whether the
 * response INTENTIONALLY anchors useful-to-society framing — vs. just
 * mentioning related words incidentally ("the team needs you to be useful
 * here" is a coincidence; "your sleeplessness is integrity working in
 * service of something larger than the deal" is the intent).
 *
 * Soft-fail; QC retry has one chance to repair.
 */
export async function checkUsefulToSocietyAnchor(
  config: AppConfig,
  candidate: string,
): Promise<CheckResult> {
  const system = `You are a brand-voice classifier for Hogaan, anchored in Hamse Warfa's Voice Rule 1: every substantive response should connect the user's challenge to broader societal value — "useful to society," in Hamse's father's framing. Useful-to-society anchoring means the response INTENTIONALLY frames leadership as in-service-of-something-larger, not incidentally mentioning related words.

Score the candidate response: pass=true if Voice Rule 1 is intentionally anchored (the response orients the user toward who/what their leadership serves beyond themselves); pass=false if the framing is missing OR only incidentally mentions community/others/society without doing the rhetorical work.

Return strict JSON {"pass": true|false, "reason": "..."} (reason ≤80 chars).`;
  try {
    const r = await runClassifier(config, system, `Candidate response:\n"""\n${candidate}\n"""`);
    return {
      checkId: 'check_15_useful_to_society_anchor',
      outcome: r.pass
        ? { status: 'pass' }
        : {
            status: 'soft_fail',
            reason: r.reason ?? 'useful-to-society anchor not intentional',
          },
    };
  } catch (err) {
    return makeServiceUnavailable('check_15_useful_to_society_anchor', err);
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

/**
 * Batch P Piece 3 — Check 17 LLM-judged practice grounding.
 *
 * Asks Groq Llama whether the response uses the tagged practice as the
 * organizing frame of the answer or merely as a vocabulary word.
 *
 * Deterministic precheck: if the candidate (lowercased) does not include
 * the practice tag word at all, skip the LLM call and auto-set verdict
 * to soft_fail. Saves cost on the easy negative cases.
 *
 * Verdict mapping:
 *   - 'grounded'  → pass
 *   - 'mentioned' → soft_fail (drift; eligible for regen)
 *   - 'absent'    → soft_fail (drift; eligible for regen)
 *
 * Skip semantics:
 *   - practiceTag undefined → not_required (untagged response modes
 *     don't reach QC anyway, but defensive guard)
 */
interface GroundingClassifierJson {
  verdict: 'grounded' | 'mentioned' | 'absent';
  evidence_quote?: string;
}

export async function check17PracticeGrounding(
  config: AppConfig,
  userMessage: string,
  candidate: string,
  practiceTag: PracticeTag | undefined,
): Promise<CheckResult> {
  if (practiceTag === undefined) {
    return { checkId: 'check_17_practice_grounding', outcome: { status: 'not_required' } };
  }

  // Deterministic precheck — if the practice word is not present at all,
  // the LLM call is unnecessary; verdict is 'absent' by construction.
  if (!candidate.toLowerCase().includes(practiceTag.toLowerCase())) {
    return {
      checkId: 'check_17_practice_grounding',
      outcome: {
        status: 'soft_fail',
        reason: `practice grounding absent: tag "${practiceTag}" not present in response`,
      },
    };
  }

  const system = `You are evaluating whether a coaching response uses a tagged practice as its organizing frame. Return STRICT JSON: {"verdict": "grounded" | "mentioned" | "absent", "evidence_quote": "≤120 chars"}. "grounded" = the practice shapes the structure of the answer. "mentioned" = the word appears but the answer is organized around something else. "absent" = the practice is not represented.`;
  const userPrompt = `Tagged practice: ${practiceTag}\n\nUser message:\n"""\n${userMessage}\n"""\n\nResponse:\n"""\n${candidate}\n"""`;

  try {
    // Batch G — migrated from Groq Llama to Anthropic Haiku 4.5 via the
    // classifierChat wrapper. Same JSON contract; the prefill-`{` pattern
    // inside classifierChat handles Anthropic's lack of native JSON mode.
    const res = await classifierChat(config, {
      systemPrompt: system,
      userPrompt,
      maxTokens: CLASSIFIER_MAX_TOKENS,
      timeoutMs: CLASSIFIER_TIMEOUT_MS,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      throw new Error(`grounding classifier returned invalid JSON: ${res.text.slice(0, 200)}`);
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('grounding classifier did not return an object');
    }
    const obj = parsed as Record<string, unknown>;
    const verdict = obj['verdict'];
    if (verdict !== 'grounded' && verdict !== 'mentioned' && verdict !== 'absent') {
      throw new Error(`grounding classifier missing valid verdict (got: ${String(verdict)})`);
    }
    const grounding: GroundingClassifierJson['verdict'] = verdict;
    const evidenceQuote = typeof obj['evidence_quote'] === 'string' ? obj['evidence_quote'] : '';

    let outcome: CheckOutcome;
    if (grounding === 'grounded') {
      outcome = { status: 'pass' };
    } else {
      outcome = {
        status: 'soft_fail',
        reason: `practice ${grounding}${evidenceQuote.length > 0 ? `: ${evidenceQuote}` : ''}`,
      };
    }
    return { checkId: 'check_17_practice_grounding', outcome };
  } catch (err) {
    return makeServiceUnavailable('check_17_practice_grounding', err);
  }
}
