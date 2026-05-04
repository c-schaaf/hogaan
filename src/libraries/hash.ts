import { createHash } from 'node:crypto';

/**
 * Canonical hash of a library payload. JSON keys are sorted at every level so
 * two payloads that differ only in property order produce the same hash.
 *
 * Process #9 §13 builds determinismHash from the resolved library hashes —
 * stable input order is required.
 */
export function canonicalHash(payload: unknown): string {
  return createHash('sha256').update(canonicalStringify(payload)).digest('hex');
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeys(obj[key]);
    }
    return sorted;
  }
  return value;
}
