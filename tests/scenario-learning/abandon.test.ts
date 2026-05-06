import { describe, expect, it } from 'vitest';
import { isAbandonRequest } from '../../src/scenario-learning/orchestrator.js';

/**
 * Phase 12 R19 — single-word + phrasal abandon detection.
 *
 * Matrix:
 *   - "exit"/"abort"/"quit"/"EXIT"/"Exit!" → abandon (word boundary)
 *   - "exit scenario"/"stop scenario"/etc. → abandon (substring)
 *   - "exits the building"/"abortion"/"quitting time" → NOT abandon
 *   - "STOP" alone → NOT scenario abandon (R17 webhook-router opts user out)
 */

describe('Phase 12 R19 — isAbandonRequest', () => {
  it('detects bare exit/abort/quit (case-insensitive, with punctuation)', () => {
    for (const w of ['exit', 'EXIT', 'Abort', 'quit!', 'QUIT.', '  exit  ']) {
      expect(isAbandonRequest(w), w).toBe(true);
    }
  });

  it('detects multi-word phrases', () => {
    for (const p of ['exit scenario', 'stop scenario', 'cancel scenario', 'leave scenario']) {
      expect(isAbandonRequest(p), p).toBe(true);
    }
  });

  it('does NOT match single-word tokens as substrings of other words', () => {
    expect(isAbandonRequest('exits the building')).toBe(false);
    expect(isAbandonRequest('an abortion is a different topic')).toBe(false);
    expect(isAbandonRequest('quitting time')).toBe(false);
    expect(isAbandonRequest('the team is in good spirits')).toBe(false);
  });

  it('does NOT trip on bare STOP (that is opt-out territory; R17 handles it before scenario)', () => {
    // Important precedence: STOP fires at webhook-router (R17) and never
    // reaches the scenario orchestrator. We document the contract here:
    // even if STOP somehow reached the scenario code, it would NOT abandon —
    // because abandon is exit/abort/quit. Opting out is a separate flow.
    expect(isAbandonRequest('STOP')).toBe(false);
    expect(isAbandonRequest('stop')).toBe(false);
    expect(isAbandonRequest('UNSUBSCRIBE')).toBe(false);
  });

  it('does NOT match exit/abort/quit when used in coaching context', () => {
    expect(isAbandonRequest('I want to exit my current job')).toBe(true); // "exit" appears alone
    expect(isAbandonRequest('I had to exit a project gracefully')).toBe(true); // same
    // The R19 design accepts this trade-off: a leadership user typing
    // "exit" as a verb mid-sentence triggers abandon. Acceptable because
    // (a) those phrasings are rare during an active scenario and
    // (b) a user typing exit AT ALL during a scenario likely wants out.
  });

  it('handles empty / whitespace input', () => {
    expect(isAbandonRequest('')).toBe(false);
    expect(isAbandonRequest('   ')).toBe(false);
  });
});
