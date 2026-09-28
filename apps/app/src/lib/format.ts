import { localDay } from '@switch-time/shared'

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
 * A duration as a screen reader should say it, for the labels that stand in for a visible {@link formatDuration}: History's day
 * cells and 状態別 rows, the correction sheet's rows. `9h 00m` gives a Japanese voice letters to spell; `9時間` it reads as a time.
 * @param ms - The duration, rounded to the minute as {@link formatDuration} rounds it, so both forms name the same time.
 * @returns
 * - `H時間` on the hour
 * - `H時間M分` past the first hour
 * - `M分` below it (`0分` under half a minute)
 * @example formatSpokenDuration(9 * 3_600_000) // '9時間'
 * @example formatSpokenDuration(545 * 60_000) // '9時間5分'
 * @example formatSpokenDuration(45 * 60_000) // '45分'
 */
export function formatSpokenDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  // Under an hour there are no hours to name.
  if (!hours) return `${minutes}分`
  return rest ? `${hours}時間${rest}分` : `${hours}時間`
}

// What every escaped name starts with: no name is read without it once it could be taken for the label's own words.
const ESCAPE = '活動'

/**
 * How a label reads one activity's name, so no name can pass for the words a label adds itself: the detox part (`detox 6時間`,
 * `detox の日`), 平均から除外, or the `、` between parts. Called for the correction sheet's rows and by
 * {@link spokenActivityNames}; never for the built-in detox entry, which is what the escape protects.
 * @param name - The activity's name as the user wrote it (the schema allows any 1–20 characters).
 * @returns
 * - `活動 <name>` for a name that, width-folded, lower-cased and without spaces, starts with `detox` or `活動`, contains
 *   `平均から除外`, or contains `、`: every escaped part then starts with 活動 and no other part can
 * - the name unchanged otherwise
 * @example spokenActivityName('仕事') // '仕事'
 * @example spokenActivityName('Detox の日') // '活動 Detox の日'
 */
export function spokenActivityName(name: string): string {
  const folded = name.normalize('NFKC').toLowerCase().replace(/\s/g, '')
  const readsAsLabelWords =
    folded.startsWith('detox') ||
    folded.startsWith(ESCAPE) ||
    folded.includes('平均から除外') ||
    folded.includes('、')
  return readsAsLabelWords ? `${ESCAPE} ${name}` : name
}

/**
 * Every activity's spoken name, told apart from the others, for History's day cells and 状態別 rows and the correction sheet's
 * rows. Built once over the whole list (live and archived) by {@link historyView} and {@link correctionRows}, so one activity
 * reads the same in every label.
 * @param activities - The activities in `position` order; that order numbers a group of equal names. No `archivedAt` means live.
 * @returns A map from activity id to its spoken name, no two alike:
 * - {@link spokenActivityName} of its name
 * - then `（アーカイブ済み）` after an archived activity whose spoken name another activity also has
 * - then `（1）`, `（2）`… in list order for names still shared (two live 仕事, two archived 仕事), skipping a number another
 *   activity's own name already reads as (a third activity named 仕事（1）)
 * @example spokenActivityNames([{ id: 'a', name: '仕事', archivedAt: null }, { id: 'b', name: '仕事', archivedAt: new Date() }])
 * // => Map { 'a' => '仕事', 'b' => '仕事（アーカイブ済み）' }
 */
export function spokenActivityNames(
  activities: readonly { id: string; name: string; archivedAt?: Date | null }[],
): Map<string, string> {
  const escaped = activities.map((activity) => ({
    ...activity,
    spoken: spokenActivityName(activity.name),
  }))
  const archivedMarked = escaped.map((activity) =>
    // Only a shared name needs the mark: an archived activity alone on its name reads as it did while live.
    Boolean(activity.archivedAt) && countOf(escaped, activity.spoken) > 1
      ? { ...activity, spoken: `${activity.spoken}（アーカイブ済み）` }
      : activity,
  )
  const isSettled = (activity: { spoken: string }) =>
    countOf(archivedMarked, activity.spoken) === 1
  // Names already final: every settled one, then each number as it is given.
  const taken = new Set(
    archivedMarked.filter(isSettled).map((activity) => activity.spoken),
  )
  const lastOrdinal = new Map<string, number>()
  return new Map(
    archivedMarked.map((activity) => {
      if (isSettled(activity)) return [activity.id, activity.spoken]
      // A name the mark did not settle is numbered across its whole group, the first one included.
      let ordinal = lastOrdinal.get(activity.spoken) ?? 0
      let numbered: string
      do {
        ordinal += 1
        numbered = `${activity.spoken}（${ordinal}）`
      } while (taken.has(numbered))
      lastOrdinal.set(activity.spoken, ordinal)
      taken.add(numbered)
      return [activity.id, numbered]
    }),
  )
}

const countOf = (list: readonly { spoken: string }[], spoken: string) =>
  list.filter((entry) => entry.spoken === spoken).length

// One formatter per zone: the timeline and the correction sheet format every row's start on each render.
// No cap: the app only formats the signed-in account's stored zone, unlike the API's cache in the shared time module.
const timeFormats = new Map<string, Intl.DateTimeFormat>()

/**
 * Wall-clock `H:MM` of an instant in the user's stored time zone (the correction sheet's row times; the hero's 「… から」 label goes
 * through {@link formatSince}).
 * @example formatTime(new Date('2026-09-09T00:05:00Z'), 'Asia/Tokyo') // '9:05'
 */
export function formatTime(date: Date, timeZone: string): string {
  let format = timeFormats.get(timeZone)
  // First use of this zone: build it once (an unknown zone throws here, before anything is cached).
  if (!format) {
    format = new Intl.DateTimeFormat('ja-JP', {
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    })
    timeFormats.set(timeZone, format)
  }
  return format.format(date)
}

/**
 * The hero's 「… から」 label: when the current record started, with its day when that was before today, so a detox or an activity
 * carried over midnight does not read as started today. The date is written as the correction sheet's origin note writes it.
 * @param date - The record's start.
 * @param today - Today in the stored zone.
 * @param timeZone - The stored zone.
 * @returns
 * - `H:MM` for a record started today (or, by a clock behind the server's, a day the device has not reached)
 * - `M月D日 H:MM` for one started on an earlier day
 * @example formatSince(new Date('2026-09-25T00:05:00Z'), '2026-09-25', 'Asia/Tokyo') // '9:05'
 * @example formatSince(new Date('2026-09-16T12:20:00Z'), '2026-09-25', 'Asia/Tokyo') // '9月16日 21:20'
 */
export function formatSince(
  date: Date,
  today: string,
  timeZone: string,
): string {
  const day = localDay(date, timeZone)
  const time = formatTime(date, timeZone)
  // Only an earlier day is named: a start the device reads as tomorrow (its clock behind the server's) keeps the bare time.
  return day < today ? `${formatMonthDay(day)} ${time}` : time
}
