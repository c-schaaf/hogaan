import { parsePhoneNumberWithError, ParseError } from 'libphonenumber-js';
import { hashPhone } from '../shared/db/encryption.js';

export interface NormalizedPhone {
  e164: string;
  /** SHA-256 hex of the E.164 form. Stable identifier. */
  hash: string;
  /** Whether the country code came from explicit user input vs. our default. */
  countrySource: 'explicit' | 'inferred-so';
}

export class PhoneNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneNormalizationError';
  }
}

const DEFAULT_COUNTRY = 'SO'; // Somalia

/**
 * Process #12 Step 2 phone normalization.
 *
 * Strips whitespace / dashes / parens. Accepts:
 *   - "+252612345678"      → +252612345678 (explicit)
 *   - "00252612345678"     → +252612345678 (explicit; 00 prefix → +)
 *   - "0612345678"         → +252612345678 (inferred-so; default country)
 *   - "+1 555 555 5555"    → +15555555555  (explicit)
 *
 * Rejects: empty string, non-digit characters after cleanup, numbers that
 * libphonenumber considers invalid for the resolved country.
 *
 * Phase 2 plan note: defaultCountry=SO is correct for the home market. When
 * we open to diaspora (Phase 3+), this needs locale or IP-based inference —
 * Phase 6.5 / plan open question §17.
 */
export function normalizePhone(raw: string): NormalizedPhone {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new PhoneNormalizationError('phone is empty');
  }

  // Strip whitespace, dashes, parens; keep + and digits.
  let cleaned = raw.replace(/[\s\-()]/g, '');

  // 00-prefix → +.
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  const hasExplicitCountry = cleaned.startsWith('+');

  let parsed;
  try {
    parsed = parsePhoneNumberWithError(cleaned, DEFAULT_COUNTRY);
  } catch (err) {
    if (err instanceof ParseError) {
      throw new PhoneNormalizationError(`phone parse failed: ${err.message}`);
    }
    throw new PhoneNormalizationError(`phone parse failed: ${(err as Error).message}`);
  }

  if (!parsed.isValid()) {
    throw new PhoneNormalizationError(`phone is not valid for country ${parsed.country ?? '?'}`);
  }

  const e164 = parsed.format('E.164');
  return {
    e164,
    hash: hashPhone(e164),
    countrySource: hasExplicitCountry ? 'explicit' : 'inferred-so',
  };
}
