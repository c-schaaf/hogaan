import { type FeatureFlag, readFeatureFlags } from '../flags/index.js';

type RequiredKey = 'NODE_ENV' | 'PORT' | 'LOG_LEVEL';

type OptionalKey =
  | 'PUBLIC_BASE_URL'
  | 'DATABASE_URL'
  | 'REDIS_URL'
  | 'UPSTASH_REDIS_REST_URL'
  | 'UPSTASH_REDIS_REST_TOKEN'
  | 'ENCRYPTION_KEY_BASE64'
  | 'JWT_SECRET_BASE64'
  | 'JWT_ISSUER'
  | 'JWT_AUDIENCE'
  | 'ANTHROPIC_API_KEY'
  | 'GROQ_API_KEY'
  | 'VOYAGE_API_KEY'
  | 'SENTRY_DSN'
  | 'AXIOM_TOKEN'
  | 'AXIOM_DATASET'
  | 'BETTERSTACK_HEARTBEAT_URL'
  | 'RESEND_API_KEY'
  | 'RESEND_FROM_EMAIL'
  | 'SUPABASE_URL'
  | 'SUPABASE_ANON_KEY'
  | 'SUPABASE_JWT_SECRET'
  | 'DEMO_MODE'
  | 'LLM_CHAT_MODEL'
  | 'LLM_CHAT_EFFORT'
  | 'LLM_BACKGROUND_MODEL'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'STRIPE_PRICE_PERSONAL'
  | 'BRIEF_UPDATE_DELAY_MS'
  | 'JOB_POLL_INTERVAL_MS'
  | 'EMAIL_LINK_SECRET';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'staging' | 'production';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  publicBaseUrl: string | undefined;
  databaseUrl: string | undefined;
  redisUrl: string | undefined;
  upstashRedisRestUrl: string | undefined;
  upstashRedisRestToken: string | undefined;
  encryptionKeyBase64: string | undefined;
  jwtSecretBase64: string | undefined;
  jwtIssuer: string | undefined;
  jwtAudience: string | undefined;
  anthropicApiKey: string | undefined;
  groqApiKey: string | undefined;
  voyageApiKey: string | undefined;
  sentryDsn: string | undefined;
  axiomToken: string | undefined;
  axiomDataset: string | undefined;
  betterstackHeartbeatUrl: string | undefined;
  resendApiKey: string | undefined;
  resendFromEmail: string | undefined;
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
  /**
   * Supabase project JWT secret — used by web-api read-side local JWT
   * verify (PR 6 D-5) to avoid the ~80–150ms `getUser` round-trip on every
   * `/api/*` call. Missing value falls back to remote `getUser`.
   */
  supabaseJwtSecret: string | undefined;
  /**
   * Demo mode (build plan, owner request). Embedded database, sign-in
   * bypassed for one sample leader, scripted coach when no model key.
   * `loadConfig` refuses to return a config with demoMode=true when
   * NODE_ENV=production. Optional so existing test fakes stay valid.
   */
  demoMode?: boolean;
  /** Feature flags — see src/shared/flags/index.ts. Missing = off. */
  features?: Partial<Record<FeatureFlag, boolean>>;
  /** Live-chat model id. Default 'claude-haiku-4-5' (today's model). */
  llmChatModel?: ChatModelId;
  /** Effort for the live-chat model when it supports effort (Haiku 5.5). */
  llmChatEffort?: 'low' | 'medium' | 'high';
  /** Background-work model id (brief updater, reflections). */
  llmBackgroundModel?: BackgroundModelId;
  stripeSecretKey?: string | undefined;
  stripeWebhookSecret?: string | undefined;
  stripePricePersonal?: string | undefined;
  /** Debounce before the post-session brief update runs. Default 10 min. */
  briefUpdateDelayMs?: number;
  /** Background job poll interval. Default 15 s. */
  jobPollIntervalMs?: number;
  /** HMAC secret for unsubscribe / reflection links in email. */
  emailLinkSecret?: string | undefined;
}

export const CHAT_MODEL_IDS = ['claude-haiku-4-5', 'claude-haiku-5-5'] as const;
export type ChatModelId = (typeof CHAT_MODEL_IDS)[number];
export const BACKGROUND_MODEL_IDS = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const;
export type BackgroundModelId = (typeof BACKGROUND_MODEL_IDS)[number];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readRequired(key: RequiredKey): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value;
}

function readOptional(key: OptionalKey): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
}

export function loadConfig(): AppConfig {
  const nodeEnvRaw = readRequired('NODE_ENV');
  if (
    nodeEnvRaw !== 'development' &&
    nodeEnvRaw !== 'test' &&
    nodeEnvRaw !== 'staging' &&
    nodeEnvRaw !== 'production'
  ) {
    throw new ConfigError(
      `NODE_ENV must be one of development|test|staging|production, got: ${nodeEnvRaw}`,
    );
  }

  const portRaw = readRequired('PORT');
  const port = Number.parseInt(portRaw, 10);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`PORT must be a valid port number, got: ${portRaw}`);
  }

  const logLevelRaw = readRequired('LOG_LEVEL');
  const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
  if (!validLevels.includes(logLevelRaw as (typeof validLevels)[number])) {
    throw new ConfigError(`LOG_LEVEL must be one of ${validLevels.join('|')}, got: ${logLevelRaw}`);
  }

  const demoRaw = readOptional('DEMO_MODE');
  const demoMode = demoRaw === 'true' || demoRaw === '1';
  if (demoMode && nodeEnvRaw === 'production') {
    // Hard stop: demo mode bypasses sign-in. It must never run in production.
    throw new ConfigError('DEMO_MODE cannot be enabled when NODE_ENV=production');
  }

  const chatModelRaw = readOptional('LLM_CHAT_MODEL') ?? 'claude-haiku-4-5';
  if (!(CHAT_MODEL_IDS as readonly string[]).includes(chatModelRaw)) {
    throw new ConfigError(
      `LLM_CHAT_MODEL must be one of ${CHAT_MODEL_IDS.join('|')}, got: ${chatModelRaw}`,
    );
  }
  const bgModelRaw = readOptional('LLM_BACKGROUND_MODEL') ?? 'claude-opus-5-5';
  if (!(BACKGROUND_MODEL_IDS as readonly string[]).includes(bgModelRaw)) {
    throw new ConfigError(
      `LLM_BACKGROUND_MODEL must be one of ${BACKGROUND_MODEL_IDS.join('|')}, got: ${bgModelRaw}`,
    );
  }
  const effortRaw = readOptional('LLM_CHAT_EFFORT') ?? 'low';
  if (effortRaw !== 'low' && effortRaw !== 'medium' && effortRaw !== 'high') {
    throw new ConfigError(`LLM_CHAT_EFFORT must be low|medium|high, got: ${effortRaw}`);
  }
  const intOpt = (k: OptionalKey, dflt: number): number => {
    const raw = readOptional(k);
    if (raw === undefined) return dflt;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) throw new ConfigError(`${k} must be a non-negative integer`);
    return n;
  };

  return {
    nodeEnv: nodeEnvRaw,
    demoMode,
    features: readFeatureFlags(process.env, demoMode),
    llmChatModel: chatModelRaw as ChatModelId,
    llmChatEffort: effortRaw,
    llmBackgroundModel: bgModelRaw as BackgroundModelId,
    stripeSecretKey: readOptional('STRIPE_SECRET_KEY'),
    stripeWebhookSecret: readOptional('STRIPE_WEBHOOK_SECRET'),
    stripePricePersonal: readOptional('STRIPE_PRICE_PERSONAL'),
    briefUpdateDelayMs: intOpt('BRIEF_UPDATE_DELAY_MS', demoMode ? 3_000 : 10 * 60_000),
    jobPollIntervalMs: intOpt('JOB_POLL_INTERVAL_MS', demoMode ? 1_000 : 15_000),
    emailLinkSecret: readOptional('EMAIL_LINK_SECRET'),
    port,
    logLevel: logLevelRaw as AppConfig['logLevel'],
    publicBaseUrl: readOptional('PUBLIC_BASE_URL'),
    databaseUrl: readOptional('DATABASE_URL'),
    redisUrl: readOptional('REDIS_URL'),
    upstashRedisRestUrl: readOptional('UPSTASH_REDIS_REST_URL'),
    upstashRedisRestToken: readOptional('UPSTASH_REDIS_REST_TOKEN'),
    encryptionKeyBase64: readOptional('ENCRYPTION_KEY_BASE64'),
    jwtSecretBase64: readOptional('JWT_SECRET_BASE64'),
    jwtIssuer: readOptional('JWT_ISSUER'),
    jwtAudience: readOptional('JWT_AUDIENCE'),
    anthropicApiKey: readOptional('ANTHROPIC_API_KEY'),
    groqApiKey: readOptional('GROQ_API_KEY'),
    voyageApiKey: readOptional('VOYAGE_API_KEY'),
    sentryDsn: readOptional('SENTRY_DSN'),
    axiomToken: readOptional('AXIOM_TOKEN'),
    axiomDataset: readOptional('AXIOM_DATASET'),
    betterstackHeartbeatUrl: readOptional('BETTERSTACK_HEARTBEAT_URL'),
    resendApiKey: readOptional('RESEND_API_KEY'),
    resendFromEmail: readOptional('RESEND_FROM_EMAIL'),
    supabaseUrl: readOptional('SUPABASE_URL'),
    supabaseAnonKey: readOptional('SUPABASE_ANON_KEY'),
    supabaseJwtSecret: readOptional('SUPABASE_JWT_SECRET'),
  };
}

/**
 * Assert that a config field is present. Use at module init when a feature is
 * unconditionally required — gives a clear startup error rather than a NPE
 * mid-request.
 */
export function requireConfig<K extends keyof AppConfig>(
  config: AppConfig,
  key: K,
): NonNullable<AppConfig[K]> {
  const value = config[key];
  if (value === undefined || value === null || value === '') {
    throw new ConfigError(`Required config missing: ${String(key)}`);
  }
  return value;
}
