import type { DayRow } from './schemas'

/**
 * cyrb53: a fast 53-bit string hash (public domain, bryc). Sync and dependency-free, since Hermes has no `crypto.subtle`;
 * the digest guards one user's own day against their other devices, so collisions are no security concern.
 * @example cyrb53('a') // 7929297801672961
 */
function cyrb53(text: string): number {
  let high = 0xdeadbeef
  let low = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    high = Math.imul(high ^ code, 2654435761)
    low = Math.imul(low ^ code, 1597334677)
  }
  high = Math.imul(high ^ (high >>> 16), 2246822507)
  high ^= Math.imul(low ^ (low >>> 13), 3266489909)
  low = Math.imul(low ^ (low >>> 16), 2246822507)
  low ^= Math.imul(high ^ (high >>> 13), 3266489909)
  return 4294967296 * (2097151 & low) + (high >>> 0)
}

/** A row as {@link dayDigest} reads it: what a listed row compares (id, activity, start) and its revision. */
export type DigestRow = Pick<
  DayRow,
  'id' | 'activityId' | 'startedAt' | 'revision'
>

/**
 * A short stand-in for a day's own rows, for a day busier than a baseline lists (`DAY_ROWS_MAX`): the correction sheet sends
 * it as the baseline's `digest` and 「元に戻す」's `expectedDigest`, and the API compares it with the digest of the rows it
 * reads under the user's lock. Any change to a row's id, activity, start or revision, or to the count, changes it.
 * @param rows - The day's own rows, oldest first.
 * @returns `${count}:${hash in hex}`
 * @example dayDigest([]) // '0:…', the same string on the app and the API
 */
export function dayDigest(rows: readonly DigestRow[]): string {
  const lines = rows.map(
    (row) =>
      `${row.id}|${row.activityId ?? '-'}|${row.startedAt.getTime()}|${row.revision ?? '-'}`,
  )
  return `${rows.length}:${cyrb53(lines.join('\n')).toString(16)}`
}
