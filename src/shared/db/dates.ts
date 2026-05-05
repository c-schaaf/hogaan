/**
 * postgres-js returns timestamp columns as ISO strings, NOT Date objects,
 * even though drizzle types them as `Date`. Any code that calls a Date
 * method (.getTime / .toISOString / .getDate / etc.) directly on a value
 * sourced from a `db.select(...)` or `db.execute(...)` result will throw:
 *
 *   TypeError: x.toISOString is not a function
 *
 * The fix is to coerce at every read boundary. Use these helpers to
 * convert DB-sourced timestamp columns into actual Date instances before
 * the value flows into business logic that assumes a Date.
 *
 * Production incident 2026-05-05: buildMemoryBlock crashed every coaching
 * turn that had at least one memory row, producing silent 204 acks with
 * no response sent. Discovered when the synthetic-cohort test data
 * accumulated enough memory entries that the bug stopped being masked.
 */

/**
 * Coerce a DB-sourced timestamp value (Date | string) to Date.
 * Throws if null or undefined.
 */
export function asDate(v: Date | string | number): Date {
  if (v instanceof Date) {
    return v;
  }
  return new Date(v);
}

/**
 * Coerce nullable DB-sourced timestamp value to Date | null.
 * Use when the column is nullable.
 */
export function asDateOrNull(v: Date | string | number | null | undefined): Date | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (v instanceof Date) {
    return v;
  }
  return new Date(v);
}
