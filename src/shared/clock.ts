/**
 * Injectable clock for time-of-day rules (quiet hours, follow-up timing,
 * weekly caps). Production always uses the real time; tests pin it so the
 * rules are tested deterministically regardless of when the suite runs.
 */
let fixed: Date | null = null;

export function now(): Date {
  return fixed !== null ? new Date(fixed) : new Date();
}

export function setClockForTests(d: Date | null): void {
  fixed = d;
}
