/**
 * `db.execute()` returns an array on postgres.js and `{ rows }` on PGlite
 * (embedded DB used by demo mode and tests). Normalize both.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
