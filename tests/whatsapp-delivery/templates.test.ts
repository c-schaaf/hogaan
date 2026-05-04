import { describe, expect, it } from 'vitest';
import { validateTemplate } from '../../src/whatsapp-delivery/index.js';

describe('validateTemplate', () => {
  it('accepts the sandbox_echo template with one param', () => {
    const r = validateTemplate('sandbox_echo', ['hello']);
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown template', () => {
    const r = validateTemplate('does_not_exist', ['x']);
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects param count mismatch (too few)', () => {
    const r = validateTemplate('sandbox_echo', []);
    expect(r).toEqual({ ok: false, reason: 'param_count' });
  });

  it('rejects param count mismatch (too many)', () => {
    const r = validateTemplate('sandbox_echo', ['a', 'b']);
    expect(r).toEqual({ ok: false, reason: 'param_count' });
  });

  it('rejects param exceeding per-slot length', () => {
    const r = validateTemplate('sandbox_echo', ['x'.repeat(1001)]);
    expect(r).toEqual({ ok: false, reason: 'param_length' });
  });
});
