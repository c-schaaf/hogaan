// Review fix: the access gate's form and its redirect after a correct code
// may only point at this site, never at a protocol-relative "//other.site".
import { describe, expect, it } from 'vitest';
import { safeSamePath } from '../../src/demo/access-gate.js';

describe('access gate: same-site paths only', () => {
  it('keeps plain paths', () => {
    expect(safeSamePath('/oauth/authorize')).toBe('/oauth/authorize');
    expect(safeSamePath('/')).toBe('/');
  });
  it('replaces anything that could leave the site', () => {
    for (const p of [
      '//evil.example/x',
      '/@/evil.example/x',
      '/%2F%2Fevil.example',
      '/a b',
      '\\\\evil',
      'https://evil.example/',
    ]) {
      expect(safeSamePath(p), p).toBe('/');
    }
  });
});
