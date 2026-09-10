const utcMidnight = (day: string) => new Date(`${day}T00:00:00Z`)

/**
 * `M月D日` of a `YYYY-MM-DD` calendar day (week titles on 記録).
 * @example formatMonthDay('2026-09-09') // '9月9日'
 */
export function formatMonthDay(day: string): string {
  const date = utcMidnight(day)
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}

/**
 * The one-character weekday of a calendar day (the week chart's labels).
 * @example formatWeekday('2026-09-09') // '水'
 */
export function formatWeekday(day: string): string {
  return '日月火水木金土'.charAt(utcMidnight(day).getUTCDay())
}

/**
 * Header date in the design's `M月D日（曜）` form from a `YYYY-MM-DD` calendar day (the API's `localDay` in the user's time zone).
 * @example formatDay('2026-09-09') // '9月9日（水）'
 */
export function formatDay(day: string): string {
  return `${formatMonthDay(day)}（${formatWeekday(day)}）`
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The elapsed-time hero: always `H:MM:SS`, hours unbounded (a night's sleep reads `9:12:03`, never wraps); negative skew clamps to zero.
 * @example formatElapsed(3_600_000) // '1:00:00'
 */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}

/**
 * A duration total as the design writes it: `41h 22m` past the first hour, bare minutes below it, rounded to the minute.
 * @example formatDuration(19 * 3_600_000) // '19h 00m'
 */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${pad(minutes % 60)}m` : `${minutes}m`
}

/**
 * Wall-clock `H:MM` of an instant in the user's stored time zone (the 「9:05 から」 line).
 * @example formatTime(new Date('2026-09-09T00:05:00Z'), 'Asia/Tokyo') // '9:05'
 */
export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date)
}
