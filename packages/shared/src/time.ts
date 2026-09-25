const DAY_MS = 86_400_000

/** The first day {@link daySchema} accepts: a chosen floor (the Unix epoch) well above years 0–99, which `Date.UTC` reads as 1900–1999 and which would break {@link dayBounds}. */
export const EARLIEST_DAY = '1970-01-01'

/** The last day {@link daySchema} accepts: a month short of year 10000, so a week or month view plus a day never makes {@link addDays} write a five-digit year. */
export const LATEST_DAY = '9999-11-30'

type Civil = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

// A backstop only: keys are lower-cased IANA names and links (about 600), so the cache never reaches it in practice.
const FORMAT_CACHE_MAX_ZONES = 1000

// The shape of an IANA name or link ('Asia/Tokyo', 'Etc/GMT+5'): ASCII, starting with a letter.
const IANA_NAME_SHAPE = /^[A-Za-z][A-Za-z0-9_/+-]*$/

// One formatter per zone: building an Intl.DateTimeFormat costs far more than formatting with it, and stats read one per tap.
const civilFormats = new Map<string, Intl.DateTimeFormat>()

// The zone's cached formatter; an unknown zone throws here, before anything is cached.
// Only IANA-shaped names are kept, lower-cased (they are case-insensitive): offsets ('+09:30', or with a U+2212 minus sign) come in thousands
// of spellings, and formatters dropped from a churning cache stay in native memory long after they are unreachable.
// Non-ASCII input skips the cache too, since toLowerCase folds the Kelvin sign (U+212A) into 'k' and would match a real zone.
function civilFormat(timeZone: string): Intl.DateTimeFormat {
  const key = IANA_NAME_SHAPE.test(timeZone) ? timeZone.toLowerCase() : null
  const cached = key === null ? undefined : civilFormats.get(key)
  if (cached) return cached
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  // Not IANA-shaped: built per call, as every zone was before the cache
  if (key === null) return format
  if (civilFormats.size >= FORMAT_CACHE_MAX_ZONES) civilFormats.clear()
  civilFormats.set(key, format)
  return format
}

// Wall-clock fields of `date` in `timeZone`. formatToParts + h23 (not toLocaleString / hour12) so Hermes and V8 agree.
function civil(date: Date, timeZone: string): Civil {
  const fields: Record<string, number> = {}
  for (const part of civilFormat(timeZone).formatToParts(date))
    fields[part.type] = Number(part.value)
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
  // Four digits even before the year 1000, so days keep sorting as strings.
  return `${String(c.year).padStart(4, '0')}-${pad(c.month)}-${pad(c.day)}`
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
 * IANA zone check that also runs on Hermes, which lacks `Intl.supportedValuesOf`. Offsets such as '+09:00', which Intl also
 * takes, are refused: devices report IANA names, and an offset would skip the formatter cache on every stats read.
 * @example isTimeZone('Asia/Tokyo') // true
 * @example isTimeZone('+09:00') // false
 */
export function isTimeZone(timeZone: string): boolean {
  if (!IANA_NAME_SHAPE.test(timeZone)) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}
