type RequiredKey = 'NODE_ENV' | 'PORT' | 'LOG_LEVEL';

type OptionalKey =
  | 'DATABASE_URL'
  | 'REDIS_URL'
  | 'UPSTASH_REDIS_REST_URL'
  | 'UPSTASH_REDIS_REST_TOKEN'
  | 'ENCRYPTION_KEY_BASE64'
  | 'ANTHROPIC_API_KEY'
  | 'GROQ_API_KEY'
  | 'VOYAGE_API_KEY'
  | 'TWILIO_ACCOUNT_SID'
  | 'TWILIO_AUTH_TOKEN'
  | 'TWILIO_WHATSAPP_FROM'
  | 'TWILIO_WEBHOOK_AUTH_TOKEN'
  | 'SENTRY_DSN'
  | 'AXIOM_TOKEN'
  | 'AXIOM_DATASET'
  | 'BETTERSTACK_HEARTBEAT_URL';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'staging' | 'production';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  databaseUrl: string | undefined;
  redisUrl: string | undefined;
  upstashRedisRestUrl: string | undefined;
  upstashRedisRestToken: string | undefined;
  encryptionKeyBase64: string | undefined;
  anthropicApiKey: string | undefined;
  groqApiKey: string | undefined;
  voyageApiKey: string | undefined;
  twilioAccountSid: string | undefined;
  twilioAuthToken: string | undefined;
  twilioWhatsAppFrom: string | undefined;
  twilioWebhookAuthToken: string | undefined;
  sentryDsn: string | undefined;
  axiomToken: string | undefined;
  axiomDataset: string | undefined;
  betterstackHeartbeatUrl: string | undefined;
}

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

  return {
    nodeEnv: nodeEnvRaw,
    port,
    logLevel: logLevelRaw as AppConfig['logLevel'],
    databaseUrl: readOptional('DATABASE_URL'),
    redisUrl: readOptional('REDIS_URL'),
    upstashRedisRestUrl: readOptional('UPSTASH_REDIS_REST_URL'),
    upstashRedisRestToken: readOptional('UPSTASH_REDIS_REST_TOKEN'),
    encryptionKeyBase64: readOptional('ENCRYPTION_KEY_BASE64'),
    anthropicApiKey: readOptional('ANTHROPIC_API_KEY'),
    groqApiKey: readOptional('GROQ_API_KEY'),
    voyageApiKey: readOptional('VOYAGE_API_KEY'),
    twilioAccountSid: readOptional('TWILIO_ACCOUNT_SID'),
    twilioAuthToken: readOptional('TWILIO_AUTH_TOKEN'),
    twilioWhatsAppFrom: readOptional('TWILIO_WHATSAPP_FROM'),
    twilioWebhookAuthToken: readOptional('TWILIO_WEBHOOK_AUTH_TOKEN'),
    sentryDsn: readOptional('SENTRY_DSN'),
    axiomToken: readOptional('AXIOM_TOKEN'),
    axiomDataset: readOptional('AXIOM_DATASET'),
    betterstackHeartbeatUrl: readOptional('BETTERSTACK_HEARTBEAT_URL'),
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
