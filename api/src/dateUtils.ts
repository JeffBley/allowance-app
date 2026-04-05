/**
 * dateUtils.ts — shared timezone-aware date helpers for allowance scheduling.
 *
 * All scheduling is calendar-day-based (not fixed-millisecond-offset) so that
 * DST transitions don't silently shift the local fire time by an hour.
 * No external date libraries are needed — we rely on Node 20's built-in
 * Intl.DateTimeFormat with full IANA timezone support.
 */

/**
 * Convert a wall-clock (calendar) date and HH:MM local time in the given IANA
 * timezone to a UTC Date.
 *
 * Algorithm — "reverse offset" trick:
 *   1. Treat the desired local H:M as if it were UTC (initial guess).
 *   2. Format that UTC instant back in the target timezone via Intl to see
 *      what local time it corresponds to.
 *   3. The difference between the formatted local time and the initial guess
 *      is the UTC offset; subtract it to land on the correct UTC instant.
 *
 * Handles DST correctly because Intl uses historical tzdata bundled with V8/ICU.
 *
 * @param year    Full year (e.g. 2026)
 * @param month   1-based month (1 = January)
 * @param day     1-based day-of-month
 * @param hour    24-hour hour (0–23)
 * @param minute  Minute (0–59)
 * @param timezone IANA timezone string (e.g. "America/New_York")
 */
export function makeZonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  // Step 1: treat the desired local time as UTC (an offset "guess").
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Step 2: format the guess in the target timezone to see its local representation.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(guess).map(p => [p.type, p.value]),
  );

  // Step 3: treat those parts as a UTC value (so we can do arithmetic).
  const localAsUtcMs = Date.UTC(
    +parts['year'],
    +parts['month'] - 1,
    +parts['day'],
    +parts['hour'],
    +parts['minute'],
    +parts['second'],
  );

  // result = guess - (localAsUtcMs - guess) = 2*guess - localAsUtcMs
  // This shifts the guess by the offset so the local clock reads exactly H:M.
  return new Date(2 * guess.getTime() - localAsUtcMs);
}

/**
 * Returns the calendar year/month/day of a UTC Date as seen in the given IANA
 * timezone.  Month is 1-based (1 = January).
 *
 * Used to advance dates by calendar days rather than fixed 24-hour increments
 * so DST transitions don't shift the configured local fire time.
 */
export function getLocalDateComponents(
  utc: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(utc).map(p => [p.type, p.value]),
  );
  return {
    year: +parts['year'],
    month: +parts['month'],  // 1-based
    day: +parts['day'],
  };
}
