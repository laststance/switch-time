/**
 * Header date in the design's `M月D日（曜）` form from a `YYYY-MM-DD` calendar day (the API's `localDay` in the user's time zone).
 * @example formatDay('2026-09-09') // '9月9日（水）'
 */
export function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${'日月火水木金土'.charAt(date.getUTCDay())}）`
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
