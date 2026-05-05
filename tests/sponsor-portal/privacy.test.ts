import { describe, expect, it } from 'vitest';
import {
  isSuppressed,
  requireSegmentSize,
  SEGMENT_SIZE_FLOOR,
  SEGMENT_SUPPRESSED_COPY,
} from '../../src/sponsor-portal/aggregation/privacy.js';

describe('requireSegmentSize', () => {
  it('returns the value when distinct users meets the default 30 floor', () => {
    const r = requireSegmentSize(30, { hello: 'world' });
    expect(r.suppressed).toBe(false);
    if (!r.suppressed) {
      expect(r.value).toEqual({ hello: 'world' });
      expect(r.distinctUsers).toBe(30);
    }
  });

  it('suppresses with the locked sentinel copy when distinct users is 29', () => {
    const r = requireSegmentSize(29, { hello: 'world' });
    expect(r.suppressed).toBe(true);
    if (r.suppressed) {
      expect(r.copy).toBe(SEGMENT_SUPPRESSED_COPY);
      expect(r.floor).toBe(SEGMENT_SIZE_FLOOR);
      expect(r.observedDistinctUsers).toBe(29);
      expect(r.reason).toBe('segment_below_floor');
    }
  });

  it('suppresses on zero', () => {
    const r = requireSegmentSize(0, []);
    expect(r.suppressed).toBe(true);
  });

  it('suppresses on negative or non-finite (defensive)', () => {
    expect(isSuppressed(requireSegmentSize(-1, {}))).toBe(true);
    expect(isSuppressed(requireSegmentSize(Number.NaN, {}))).toBe(true);
    expect(isSuppressed(requireSegmentSize(Number.POSITIVE_INFINITY, {}))).toBe(true);
  });

  it('honors a custom floor when provided', () => {
    expect(isSuppressed(requireSegmentSize(15, {}, 10))).toBe(false);
    expect(isSuppressed(requireSegmentSize(15, {}, 20))).toBe(true);
  });

  it('exact sentinel copy is the locked Phase 9 wording', () => {
    expect(SEGMENT_SUPPRESSED_COPY).toBe(
      'Segment too small to display \u2014 we protect individual users by suppressing groups smaller than 30.',
    );
  });

  it('floor constant is 30', () => {
    expect(SEGMENT_SIZE_FLOOR).toBe(30);
  });
});
