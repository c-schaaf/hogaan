import { describe, expect, it } from 'vitest';
import {
  INTENT_LENGTH_BANDS,
  checkIntentLength,
  countWords,
} from '../../src/quality-check/intent-length-bands.js';
import { INTENTS, type Intent } from '../../src/shared/types/index.js';

/**
 * Phase 11 R32 — per-intent length bands.
 *
 * Two layers of guarantee:
 *   1. Every Intent in the catalog has a band (typecheck enforced + runtime
 *      assertion below). A future Intent added without a band trips the test.
 *   2. checkIntentLength returns pass/too_short/too_long with concrete numbers,
 *      so the QC orchestrator can soft-fail with an actionable reason.
 *
 * The static templates from the orchestrator are NOT imported here on purpose
 * — they're tested where they live (tests/coaching/short-circuit-intents.test.ts
 * already constrains the templated path). This test pins the bands themselves.
 */

describe('Phase 11 R32 — INTENT_LENGTH_BANDS coverage', () => {
  it('every Intent in INTENTS has a band', () => {
    for (const intent of INTENTS) {
      expect(INTENT_LENGTH_BANDS[intent]).toBeDefined();
      const band = INTENT_LENGTH_BANDS[intent];
      expect(band.min).toBeGreaterThan(0);
      expect(band.max).toBeGreaterThan(band.min);
    }
  });

  it('Greeting band is 10..80 (audit-prescribed)', () => {
    expect(INTENT_LENGTH_BANDS.Greeting).toEqual({ min: 10, max: 80 });
  });

  it('Affirmation band is 5..50 (audit-prescribed)', () => {
    expect(INTENT_LENGTH_BANDS.Affirmation).toEqual({ min: 5, max: 50 });
  });

  it('Coaching band is 150..300 (audit-prescribed)', () => {
    expect(INTENT_LENGTH_BANDS.Coaching).toEqual({ min: 150, max: 300 });
  });

  it('ScenarioRequest band is 150..400 (audit-prescribed)', () => {
    expect(INTENT_LENGTH_BANDS.ScenarioRequest).toEqual({ min: 150, max: 400 });
  });
});

describe('Phase 11 R32 — checkIntentLength behavior', () => {
  it('counts words by whitespace, ignoring leading/trailing space', () => {
    expect(countWords('  hello   world  ')).toBe(2);
    expect(countWords('one two three four five')).toBe(5);
    expect(countWords('')).toBe(0);
  });

  it('passes a Greeting at the lower bound (10 words)', () => {
    const text = 'one two three four five six seven eight nine ten';
    const result = checkIntentLength(text, 'Greeting');
    expect(result.status).toBe('pass');
    if (result.status === 'pass') {
      expect(result.words).toBe(10);
    }
  });

  it('flags too_short for a Coaching reply with only 50 words', () => {
    const text = Array(50).fill('word').join(' ');
    const result = checkIntentLength(text, 'Coaching');
    expect(result.status).toBe('too_short');
    if (result.status === 'too_short') {
      expect(result.words).toBe(50);
      expect(result.min).toBe(150);
      expect(result.intent).toBe('Coaching');
    }
  });

  it('flags too_long for a Greeting reply with 200 words', () => {
    const text = Array(200).fill('word').join(' ');
    const result = checkIntentLength(text, 'Greeting');
    expect(result.status).toBe('too_long');
    if (result.status === 'too_long') {
      expect(result.words).toBe(200);
      expect(result.max).toBe(80);
      expect(result.intent).toBe('Greeting');
    }
  });

  it('boundary: exactly at max passes (inclusive)', () => {
    const greeting80 = Array(80).fill('word').join(' ');
    expect(checkIntentLength(greeting80, 'Greeting').status).toBe('pass');
  });

  it('boundary: one word over max trips too_long', () => {
    const greeting81 = Array(81).fill('word').join(' ');
    expect(checkIntentLength(greeting81, 'Greeting').status).toBe('too_long');
  });

  it('every intent rejects a 1000-word response', () => {
    const text = Array(1000).fill('word').join(' ');
    for (const intent of INTENTS as readonly Intent[]) {
      const result = checkIntentLength(text, intent);
      expect(result.status, `intent=${intent}`).toBe('too_long');
    }
  });
});
