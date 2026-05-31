import type { AppConfig } from '../secrets/config.js';

// SCRUM-F5: defense-in-depth PII scrubbing (Hard Rule #3). Call sites should
// already hash sensitive fields (see `hashEmail` / `userIdHash` patterns) —
// these paths are the safety net for a future developer who forgets and
// writes `{ email }` or `{ phone_number }` into a log line. Adding a field
// here means Pino removes it from EVERY log line, regardless of nesting.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.phoneNumber',
  '*.phone_number',
  '*.email',
  '*.user_email',
  '*.userEmail',
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
