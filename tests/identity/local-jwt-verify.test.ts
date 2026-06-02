import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetSupabaseJwtCacheForTests,
  verifySupabaseJwtLocal,
} from '../../src/web-api/local-jwt.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';

const SECRET = 'super-secret-supabase-jwt-secret-of-sufficient-length-for-hs256';
const PROJECT_URL = 'https://abc.supabase.co';
const ISSUER = `${PROJECT_URL}/auth/v1`;
const AUDIENCE = 'authenticated';

async function makeToken(opts: {
  sub: string;
  email: string;
  expSecondsFromNow?: number;
  fullName?: string;
  issuer?: string;
  audience?: string;
  secret?: string;
}): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + (opts.expSecondsFromNow ?? 3600);
  return new SignJWT({
    sub: opts.sub,
    email: opts.email,
    user_metadata: opts.fullName !== undefined ? { full_name: opts.fullName } : undefined,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

describe('verifySupabaseJwtLocal', () => {
  beforeEach(() => {
    resetSupabaseJwtCacheForTests();
  });

  it('returns null when SUPABASE_JWT_SECRET is not configured', async () => {
    const cfg = fakeConfig({ supabaseJwtSecret: undefined, supabaseUrl: PROJECT_URL });
    const token = await makeToken({ sub: 'u1', email: 'a@b.test' });
    expect(await verifySupabaseJwtLocal(cfg, token)).toBeNull();
  });

  it('verifies a valid HS256 token and returns claims', async () => {
    const cfg = fakeConfig({ supabaseJwtSecret: SECRET, supabaseUrl: PROJECT_URL });
    const token = await makeToken({ sub: 'u-1', email: 'Alice@Example.com', fullName: 'Alice' });
    const claims = await verifySupabaseJwtLocal(cfg, token);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('u-1');
    // Email is lowercased.
    expect(claims?.email).toBe('alice@example.com');
    expect(claims?.fullName).toBe('Alice');
  });

  it('returns null on a token signed with the wrong secret (tamper detection)', async () => {
    const cfg = fakeConfig({ supabaseJwtSecret: SECRET, supabaseUrl: PROJECT_URL });
    const evilToken = await new SignJWT({
      sub: 'u-1',
      email: 'a@b.test',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .sign(new TextEncoder().encode('not-the-real-secret'));
    expect(await verifySupabaseJwtLocal(cfg, evilToken)).toBeNull();
  });

  it('returns null on an expired token', async () => {
    const cfg = fakeConfig({ supabaseJwtSecret: SECRET, supabaseUrl: PROJECT_URL });
    const token = await makeToken({ sub: 'u-1', email: 'a@b.test', expSecondsFromNow: -60 });
    expect(await verifySupabaseJwtLocal(cfg, token)).toBeNull();
  });

  it('returns null on a malformed token', async () => {
    const cfg = fakeConfig({ supabaseJwtSecret: SECRET, supabaseUrl: PROJECT_URL });
    expect(await verifySupabaseJwtLocal(cfg, 'not-a-jwt')).toBeNull();
  });

  it('verifies a token with the expected iss and aud', async () => {
    const cfg = fakeConfig({ supabaseJwtSecret: SECRET, supabaseUrl: PROJECT_URL });
    const token = await makeToken({
      sub: 'u-iss-aud',
      email: 'good@example.com',
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const claims = await verifySupabaseJwtLocal(cfg, token);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('u-iss-aud');
  });

  it('returns null on a token with a wrong issuer (different Supabase project)', async () => {
    const cfg = fakeConfig({ supabaseJwtSecret: SECRET, supabaseUrl: PROJECT_URL });
    const token = await makeToken({
      sub: 'u-1',
      email: 'a@b.test',
      issuer: 'https://OTHER.supabase.co/auth/v1',
    });
    expect(await verifySupabaseJwtLocal(cfg, token)).toBeNull();
  });

  it('returns null on a token with a wrong audience (anon instead of authenticated)', async () => {
    const cfg = fakeConfig({ supabaseJwtSecret: SECRET, supabaseUrl: PROJECT_URL });
    const token = await makeToken({
      sub: 'u-1',
      email: 'a@b.test',
      audience: 'anon',
    });
    expect(await verifySupabaseJwtLocal(cfg, token)).toBeNull();
  });
});
