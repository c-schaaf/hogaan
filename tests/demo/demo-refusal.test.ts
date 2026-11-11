import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { assertDemoAllowed, DemoRefusedError, prepareDemoEnv } from '../../src/demo/server.js';
import { ConfigError, loadConfig } from '../../src/shared/secrets/config.js';
import {
  DEMO_ACCESS_TOKEN,
  DemoModeInProductionError,
  readSupabaseSession,
} from '../../src/web-api/supabase-session.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('demo mode can never run in production', () => {
  it('loadConfig throws when DEMO_MODE=true and NODE_ENV=production', () => {
    process.env = { NODE_ENV: 'production', PORT: '3000', LOG_LEVEL: 'info', DEMO_MODE: 'true' };
    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/DEMO_MODE cannot be enabled/);
  });

  it('review fix: demo mode is refused on staging too (its demo key is public)', () => {
    process.env = { NODE_ENV: 'staging', PORT: '3000', LOG_LEVEL: 'info', DEMO_MODE: 'true' };
    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => assertDemoAllowed({ NODE_ENV: 'staging' })).toThrow(DemoRefusedError);
  });

  it('loadConfig accepts DEMO_MODE outside production', () => {
    process.env = { NODE_ENV: 'development', PORT: '3000', LOG_LEVEL: 'info', DEMO_MODE: 'true' };
    expect(loadConfig().demoMode).toBe(true);
  });

  it('the demo launcher refuses NODE_ENV=production (any case / whitespace)', () => {
    expect(() => assertDemoAllowed({ NODE_ENV: 'production' })).toThrow(DemoRefusedError);
    expect(() => assertDemoAllowed({ NODE_ENV: ' Production ' })).toThrow(DemoRefusedError);
    expect(() => assertDemoAllowed({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('prepareDemoEnv refuses production and strips real-service credentials', () => {
    expect(() => prepareDemoEnv({ NODE_ENV: 'production' })).toThrow(DemoRefusedError);
    const env = prepareDemoEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://real',
      SUPABASE_URL: 'https://real.supabase.co',
      RESEND_API_KEY: 're_real',
      STRIPE_SECRET_KEY: 'sk_live_x',
    });
    expect(env['DATABASE_URL']).toBeUndefined();
    expect(env['SUPABASE_URL']).toBeUndefined();
    expect(env['RESEND_API_KEY']).toBeUndefined();
    expect(env['STRIPE_SECRET_KEY']).toBeUndefined();
    expect(env['DEMO_MODE']).toBe('true');
  });

  it('the demo sign-in path itself refuses a production config (defence in depth)', async () => {
    const app = Fastify();
    let caught: unknown;
    app.get('/x', async (req) => {
      try {
        await readSupabaseSession(req, {
          config: fakeConfig({ nodeEnv: 'production', demoMode: true }),
          db: {} as never,
        });
      } catch (err) {
        caught = err;
      }
      return {};
    });
    await app.inject({ url: '/x', headers: { authorization: `Bearer ${DEMO_ACCESS_TOKEN}` } });
    expect(caught).toBeInstanceOf(DemoModeInProductionError);
  });
});
