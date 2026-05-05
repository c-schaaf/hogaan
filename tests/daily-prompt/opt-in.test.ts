import { describe, expect, it } from 'vitest';
import { isOptedIn } from '../../src/daily-prompt/opt-in.js';

describe('isOptedIn', () => {
  it('defaults to opted-in when profileFlags is null', () => {
    expect(isOptedIn(null)).toBe(true);
    expect(isOptedIn(undefined)).toBe(true);
  });

  it('defaults to opted-in when the flag is missing', () => {
    expect(isOptedIn({})).toBe(true);
    expect(isOptedIn({ otherFlag: true })).toBe(true);
  });

  it('treats explicit false as opted-out', () => {
    expect(isOptedIn({ dailyPromptsOptedIn: false })).toBe(false);
  });

  it('treats explicit true as opted-in', () => {
    expect(isOptedIn({ dailyPromptsOptedIn: true })).toBe(true);
  });

  it('treats non-boolean flag values as opted-in (defensive)', () => {
    expect(isOptedIn({ dailyPromptsOptedIn: 'no' })).toBe(true);
    expect(isOptedIn({ dailyPromptsOptedIn: 0 })).toBe(true);
  });

  it('handles non-object profileFlags as opted-in', () => {
    expect(isOptedIn('not an object')).toBe(true);
    expect(isOptedIn(42)).toBe(true);
  });
});
