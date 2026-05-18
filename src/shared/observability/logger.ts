import type { AppConfig } from '../secrets/config.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.phoneNumber',
  '*.phone_number',
  '*.ANTHROPIC_API_KEY',
  '*.GROQ_API_KEY',
  '*.VOYAGE_API_KEY',
];

export function loggerOptionsFor(config: AppConfig) {
  const base = {
    level: config.logLevel,
    base: {
      env: config.nodeEnv,
      service: 'hogaan',
    },
    redact: { paths: REDACT_PATHS, remove: true },
  } as const;

  if (config.nodeEnv === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    };
  }

  return base;
}
