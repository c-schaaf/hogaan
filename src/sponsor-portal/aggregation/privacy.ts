/**
 * Phase 9A.6 — privacy boundary enforcement (CLAUDE.md hard rule #5).
 *
 * "Sponsors never see individual user data. Aggregate-only reporting,
 *  minimum 30 active users per segment."
 *
 * Defense in depth — TWO layers must agree:
 *
 *   1. SQL layer: aggregation queries use `HAVING count(distinct user_id) >= N`
 *      so the database itself returns NO rows for under-threshold segments.
 *
 *   2. App layer (this module): every aggregation handler wraps its result
 *      in `requireSegmentSize()`. If the count falls below the floor, the
 *      handler MUST return the explicit `SegmentSuppressed` sentinel — never
 *      a silent empty response. Templates render the sentinel as user-facing
 *      copy that explains *why* the data is hidden.
 *
 * Silent empty results are a privacy-floor failure. The sentinel is the
 * required UX so a sponsor immediately sees "we are protecting users",
 * not "this segment has zero activity".
 */

export const SEGMENT_SIZE_FLOOR = 30;

/**
 * The exact user-facing copy. Locked per Phase 9 plan (2026-05-05). Do not
 * paraphrase in templates — pull from this constant.
 */
export const SEGMENT_SUPPRESSED_COPY =
  'Segment too small to display \u2014 we protect individual users by suppressing groups smaller than 30.';

export interface SegmentSuppressed {
  readonly suppressed: true;
  readonly reason: 'segment_below_floor';
  readonly floor: number;
  readonly observedDistinctUsers: number;
  readonly copy: typeof SEGMENT_SUPPRESSED_COPY;
}

export interface SegmentVisible<T> {
  readonly suppressed: false;
  readonly distinctUsers: number;
  readonly value: T;
}

export type Segment<T> = SegmentVisible<T> | SegmentSuppressed;

/**
 * Wrap an aggregation result with the privacy floor. Caller passes the
 * distinct-user count it computed alongside its data; this returns either
 * the data (if N >= floor) or the suppression sentinel.
 *
 * Always return — never throw — so a single under-threshold segment
 * doesn't break a multi-segment dashboard.
 */
export function requireSegmentSize<T>(
  distinctUsers: number,
  value: T,
  floor: number = SEGMENT_SIZE_FLOOR,
): Segment<T> {
  if (!Number.isFinite(distinctUsers) || distinctUsers < 0) {
    // Defensive — a non-finite count means the upstream query gave us
    // garbage. Treat as suppressed so we never leak.
    return {
      suppressed: true,
      reason: 'segment_below_floor',
      floor,
      observedDistinctUsers: 0,
      copy: SEGMENT_SUPPRESSED_COPY,
    };
  }
  if (distinctUsers < floor) {
    return {
      suppressed: true,
      reason: 'segment_below_floor',
      floor,
      observedDistinctUsers: distinctUsers,
      copy: SEGMENT_SUPPRESSED_COPY,
    };
  }
  return { suppressed: false, distinctUsers, value };
}

export function isSuppressed<T>(segment: Segment<T>): segment is SegmentSuppressed {
  return segment.suppressed === true;
}
