import { describe, expect, it } from 'vitest';
import { fastPathTriage, _CRISIS_KEYWORDS } from '../../src/coaching/index.js';

describe('fastPathTriage — synchronous decisions', () => {
  it('flags empty body and no media → empty', () => {
    const r = fastPathTriage('', []);
    expect(r?.status).toBe('empty');
  });

  it('flags media without text → media_only', () => {
    const r = fastPathTriage('', ['https://m.example/a.jpg']);
    expect(r?.status).toBe('media_only');
  });

  it('flags suicide language → crisis', () => {
    const r = fastPathTriage('I want to kill myself', []);
    expect(r?.status).toBe('crisis');
  });

  it('flags abuse language → crisis', () => {
    const r = fastPathTriage('My partner beats me', []);
    expect(r?.status).toBe('crisis');
  });

  it('returns null on benign messages → defers to LLM classifier', () => {
    expect(fastPathTriage('I have a leadership question', [])).toBeNull();
    expect(fastPathTriage('Hi, how do I lead my team?', [])).toBeNull();
  });

  it('crisis keyword catalog has at least 25 entries (red-team coverage)', () => {
    expect(_CRISIS_KEYWORDS.length).toBeGreaterThanOrEqual(25);
  });

  it('case-insensitive — "I WANT TO DIE" matches', () => {
    const r = fastPathTriage('I WANT TO DIE', []);
    expect(r?.status).toBe('crisis');
  });
});
