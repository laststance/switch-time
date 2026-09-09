const DAY_MS = 86_400_000

type Civil = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

// Wall-clock fields of `date` in `timeZone`. formatToParts + h23 (not toLocaleString / hour12) so Hermes and V8 agree.
function civil(date: Date, timeZone: string): Civil {
  const fields: Record<string, number> = {}
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  for (const part of parts) fields[part.type] = Number(part.value)
  return fields as Civil
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Offset of `timeZone` from UTC at `date` in ms, positive east of Greenwich; the DST-aware piece under {@link dayBounds}.
 * @example tzOffsetMs(new Date('2026-09-09T00:00:00Z'), 'Asia/Tokyo') // 32_400_000
 */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const c = civil(date, timeZone)
  const wall = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second)
  return wall - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * Calendar day ('YYYY-MM-DD') that `date` falls on in `timeZone`; every 「今日」 in stats comes from it.
 * @example localDay(new Date('2026-09-09T16:00:00Z'), 'Asia/Tokyo') // '2026-09-10'
 */
export function localDay(date: Date, timeZone: string): string {
  const c = civil(date, timeZone)
  return `${c.year}-${pad(c.month)}-${pad(c.day)}`
}

const HOUR_MS = 3_600_000

// Instant of local midnight; the second pass fixes the guess when a DST change sits between UTC and local midnight.
function localMidnight(day: string, timeZone: string): number {
  const wall = Date.parse(`${day}T00:00:00Z`)
  const guess = wall - tzOffsetMs(new Date(wall), timeZone)
  const start = wall - tzOffsetMs(new Date(guess), timeZone)
  // Where DST skips local midnight itself (Santiago, Havana) the second pass lands an hour before the day: use the transition.
  return localDay(new Date(start), timeZone) === day ? start : start + HOUR_MS
}

/**
 * [start, end) instants (ms) of a local calendar day; 23h/25h on DST days.
 * @example dayBounds('2026-09-09', 'Asia/Tokyo') // { start: 1757343600000, end: 1757430000000 }
 */
export function dayBounds(
  day: string,
  timeZone: string,
): { start: number; end: number } {
  return {
    start: localMidnight(day, timeZone),
    end: localMidnight(addDays(day, 1), timeZone),
  }
}

/**
 * `day` shifted by `n` calendar days (negative allowed); UTC arithmetic, so no DST drift.
 * @example addDays('2026-02-28', 1) // '2026-03-01'
 */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

/**
 * Number of days in 'YYYY-MM'; sizes the `stats.month` range.
 * @example daysInMonth('2026-02') // 28
 */
export function daysInMonth(month: string): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate()
}

/**
 * True for a real 'YYYY-MM-DD' date (rejects '2026-02-31'); the {@link daySchema} refinement.
 * @example isCalendarDay('2026-02-31') // false
 */
export function isCalendarDay(day: string): boolean {
  const ms = Date.parse(`${day}T00:00:00Z`)
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(day)
}

/**
 * IANA zone check that also runs on Hermes, which lacks `Intl.supportedValuesOf`.
 * @example isTimeZone('Asia/Tokyo') // true
 */
export function isTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}
