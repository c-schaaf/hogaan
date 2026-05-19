import { describe, expect, it } from 'vitest';
import { promptTemplatesV2Unified } from '../../src/libraries/seed/prompt-templates.js';

/**
 * SCRUM-50 regression test for the v3_leadership brand rewrite. The
 * assertions encode the spec, not the prose — if the prompt is edited in
 * a way that violates one of these, STOP and surface; do NOT weaken the
 * test.
 */
describe('SCRUM-50 — v3_leadership system prompt', () => {
  const first = promptTemplatesV2Unified.templates[0]!;
  const systemText = first.systemText;
  const lower = systemText.toLowerCase();

  it('mentions the 12-practice framework', () => {
    expect(lower).toContain('12-practice framework');
  });

  it('mentions transformational leadership', () => {
    expect(lower).toContain('transformational leadership');
  });

  it('carries the BELONGING / INSPIRING / AUTHENTIC brand traits', () => {
    expect(lower).toContain('belonging');
    expect(lower).toContain('inspiring');
    expect(lower).toContain('authentic');
  });

  it('does NOT carry any of the retired therapeutic / crisis-protocol strings', () => {
    const forbidden = [
      '988',
      '741741',
      'Crisis Protocol',
      'therapeutic companion',
      'SFBT',
      'CBT',
      'DBT',
      'values-driven companion',
    ];
    for (const phrase of forbidden) {
      expect(systemText).not.toContain(phrase);
    }
  });

  it('first template id is exactly coaching_v3_leadership', () => {
    expect(first.id).toBe('coaching_v3_leadership');
  });

  it('all five response-mode entries point at the same systemText instance', () => {
    expect(promptTemplatesV2Unified.templates).toHaveLength(5);
    for (const t of promptTemplatesV2Unified.templates) {
      expect(t.systemText).toBe(systemText);
    }
  });
});
