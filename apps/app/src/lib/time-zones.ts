import { isTimeZone, tzOffsetMs } from '@switch-time/shared'

import { CATALOG_ZONES, ZONE_ALIASES } from './time-zone-catalog'

// Japanese city names for the zones the タイムゾーン sheet lists before any search, one or two per region, west to east.
const CITIES: Readonly<Record<string, string>> = {
  'Pacific/Pago_Pago': 'パゴパゴ',
  'Pacific/Honolulu': 'ホノルル',
  'America/Anchorage': 'アンカレッジ',
  'America/Los_Angeles': 'ロサンゼルス',
  'America/Vancouver': 'バンクーバー',
  'America/Denver': 'デンバー',
  'America/Phoenix': 'フェニックス',
  'America/Chicago': 'シカゴ',
  'America/Mexico_City': 'メキシコシティ',
  'America/New_York': 'ニューヨーク',
  'America/Toronto': 'トロント',
  'America/Bogota': 'ボゴタ',
  'America/Lima': 'リマ',
  'America/Halifax': 'ハリファックス',
  'America/Caracas': 'カラカス',
  'America/Santiago': 'サンティアゴ',
  'America/St_Johns': 'セントジョンズ',
  'America/Sao_Paulo': 'サンパウロ',
  'America/Argentina/Buenos_Aires': 'ブエノスアイレス',
  'Atlantic/Azores': 'アゾレス諸島',
  UTC: '協定世界時',
  'Europe/London': 'ロンドン',
  'Europe/Dublin': 'ダブリン',
  'Europe/Lisbon': 'リスボン',
  'Atlantic/Reykjavik': 'レイキャビク',
  'Europe/Paris': 'パリ',
  'Europe/Berlin': 'ベルリン',
  'Europe/Madrid': 'マドリード',
  'Europe/Rome': 'ローマ',
  'Europe/Amsterdam': 'アムステルダム',
  'Europe/Stockholm': 'ストックホルム',
  'Africa/Lagos': 'ラゴス',
  'Europe/Athens': 'アテネ',
  'Europe/Helsinki': 'ヘルシンキ',
  'Africa/Cairo': 'カイロ',
  'Africa/Johannesburg': 'ヨハネスブルグ',
  'Asia/Jerusalem': 'エルサレム',
  'Europe/Istanbul': 'イスタンブール',
  'Europe/Moscow': 'モスクワ',
  'Asia/Riyadh': 'リヤド',
  'Africa/Nairobi': 'ナイロビ',
  'Asia/Tehran': 'テヘラン',
  'Asia/Dubai': 'ドバイ',
  'Asia/Kabul': 'カブール',
  'Asia/Karachi': 'カラチ',
  'Asia/Tashkent': 'タシケント',
  'Asia/Kolkata': 'コルカタ',
  'Asia/Kathmandu': 'カトマンズ',
  'Asia/Dhaka': 'ダッカ',
  'Asia/Yangon': 'ヤンゴン',
  'Asia/Bangkok': 'バンコク',
  'Asia/Jakarta': 'ジャカルタ',
  'Asia/Ho_Chi_Minh': 'ホーチミン',
  'Asia/Shanghai': '上海',
  'Asia/Hong_Kong': '香港',
  'Asia/Taipei': '台北',
  'Asia/Singapore': 'シンガポール',
  'Asia/Manila': 'マニラ',
  'Australia/Perth': 'パース',
  'Asia/Tokyo': '東京',
  'Asia/Seoul': 'ソウル',
  'Australia/Darwin': 'ダーウィン',
  'Australia/Adelaide': 'アデレード',
  'Australia/Brisbane': 'ブリスベン',
  'Australia/Sydney': 'シドニー',
  'Pacific/Guam': 'グアム',
  'Pacific/Noumea': 'ヌメア',
  'Pacific/Auckland': 'オークランド',
  'Pacific/Fiji': 'スバ',
  'Pacific/Tongatapu': 'ヌクアロファ',
  'Pacific/Kiritimati': 'キリスィマスィ島',
}

// The catalog's country per zone; UTC has none, so it gets its own region.
const COUNTRIES = new Map<string, string>([...CATALOG_ZONES, ['UTC', 'UTC']])

const MINUTE_MS = 60_000

/** One zone the タイムゾーン sheet can list: its readable name, its country and its offset now (null where this runtime lacks the zone). */
export type ZoneEntry = {
  id: string
  city: string
  country: string
  offsetMs: number | null
  /** Listed before any search (the zones with a Japanese city name). */
  curated: boolean
  /** City, country and id folded by {@link foldForSearch}. */
  searchText: string
}

/**
 * The catalog id a device's zone name stands for: ICU still answers Asia/Kolkata as Asia/Calcutta, so both name one row.
 * @example canonicalZone('Asia/Calcutta') // 'Asia/Kolkata'
 * @example canonicalZone('Asia/Tokyo') // 'Asia/Tokyo'
 */
export const canonicalZone = (id: string): string => ZONE_ALIASES[id] ?? id

/**
 * The readable name of a zone, never the raw IANA id where a city can be named: 設定's タイムゾーン summary and each sheet row.
 * @param id - An IANA zone, possibly an older alias.
 * @returns
 * - the Japanese city for a listed zone
 * - otherwise the id's last part with `_` read as a space (`America/Argentina/Rio_Gallegos` → `Rio Gallegos`)
 * - the id itself for `Etc/*` and single-part ids, which name no city
 * @example zoneLabel('America/New_York') // 'ニューヨーク'
 * @example zoneLabel('Etc/GMT+5') // 'Etc/GMT+5'
 */
export function zoneLabel(id: string): string {
  const canonical = canonicalZone(id)
  const city = CITIES[canonical]
  if (city !== undefined) return city
  const parts = canonical.split('/')
  if (parts.length < 2 || parts[0] === 'Etc') return canonical
  return (parts.at(-1) ?? canonical).replaceAll('_', ' ')
}

/**
 * `UTC+9`, `UTC+5:30`, `UTC-3`, `UTC±0`: a zone's offset as the sheet's sub line shows it.
 * @param offsetMs - Offset from UTC in ms, positive east ({@link tzOffsetMs}).
 * @example zoneOffsetLabel(19_800_000) // 'UTC+5:30'
 * @example zoneOffsetLabel(-10_800_000) // 'UTC-3'
 */
export function zoneOffsetLabel(offsetMs: number): string {
  if (offsetMs === 0) return 'UTC±0'
  const minutes = Math.abs(Math.round(offsetMs / MINUTE_MS))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const sign = offsetMs > 0 ? '+' : '-'
  return rest === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(rest).padStart(2, '0')}`
}

/**
 * Text as the sheet's search compares it: NFKC (full-width letters), lower case, hiragana read as katakana, `_` and `/` as spaces.
 * @example foldForSearch('にゅーよーく') // 'ニューヨーク'
 * @example foldForSearch('America/New_York') // 'america new york'
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[ぁ-ゖ]/g, (kana) =>
      String.fromCharCode(kana.charCodeAt(0) + 0x60),
    )
    .replaceAll(/[_/]/g, ' ')
}

/**
 * One zone as a sheet row, whether or not it is in the catalog (a device or a stored zone can be anything Intl accepts).
 * A zone this runtime cannot format gets no offset rather than throwing, so one odd stored value cannot break the sheet.
 * @example zoneEntry('Asia/Tokyo', new Date('2026-09-29T00:00:00Z')).offsetMs // 32_400_000
 */
export function zoneEntry(id: string, now: Date): ZoneEntry {
  const canonical = canonicalZone(id)
  const city = zoneLabel(id)
  const country =
    COUNTRIES.get(canonical) ?? (canonical.startsWith('Etc/') ? 'UTC' : '')
  return {
    id,
    city,
    country,
    offsetMs: isTimeZone(id) ? tzOffsetMs(now, id) : null,
    curated: CITIES[canonical] !== undefined,
    searchText: foldForSearch(`${city} ${country} ${canonical}`),
  }
}

/**
 * Every zone the sheet can search, with its offset at `now`: the catalog plus UTC, less any zone this runtime lacks (an older
 * ICU on a phone). Built once per sheet mount, since each offset is an Intl lookup.
 * @example zoneCatalog(new Date()).length // 419 on a current ICU
 */
export function zoneCatalog(now: Date): ZoneEntry[] {
  return [...COUNTRIES.keys()]
    .map((id) => zoneEntry(id, now))
    .filter((entry) => entry.offsetMs !== null)
}

// West to east, then by the name as a Japanese reader sorts it.
const byOffsetThenCity = (a: ZoneEntry, b: ZoneEntry): number =>
  (a.offsetMs ?? 0) - (b.offsetMs ?? 0) || a.city.localeCompare(b.city, 'ja')

/**
 * The rows of the タイムゾーン sheet. This device's zone comes first and the account's zone (as the sheet opened) second, so the
 * current choice is visible without scrolling; then, before any search, the zones with a Japanese name, or, for a search, every
 * zone that matches its city, country or id. Each zone appears once, whichever name the device used for it.
 * @param catalog - {@link zoneCatalog}, built when the sheet opened.
 * @param zones.query - The search field's text.
 * @param zones.device - This device's zone.
 * @param zones.pinned - The account's zone when the sheet opened, undefined until settings have been read.
 * @param now - The moment offsets are read at, for a pinned zone outside the catalog.
 * @returns The rows in display order; an empty list when a search matches nothing.
 * @example zoneChoices(zoneCatalog(now), { query: '', device: 'Asia/Tokyo', pinned: 'America/New_York' }, now).map((row) => row.city).slice(0, 2) // ['東京', 'ニューヨーク']
 */
export function zoneChoices(
  catalog: readonly ZoneEntry[],
  zones: { query: string; device: string; pinned: string | undefined },
  now: Date,
): ZoneEntry[] {
  const query = foldForSearch(zones.query.trim())
  const matches = (entry: ZoneEntry): boolean =>
    query === '' || entry.searchText.includes(query)
  const pinnedIds = [
    ...new Set(
      [zones.device, zones.pinned]
        .filter((id): id is string => id !== undefined)
        .map(canonicalZone),
    ),
  ]
  const pinned = pinnedIds
    .map(
      (id) =>
        catalog.find((entry) => entry.id === id) ??
        // A zone outside the catalog (an `Etc/*` zone, one this runtime lacks) is still shown as it is.
        zoneEntry(id, now),
    )
    .filter(matches)
  const rest = catalog
    .filter((entry) => !pinnedIds.includes(entry.id))
    .filter((entry) => (query === '' ? entry.curated : matches(entry)))
    .sort(byOffsetThenCity)
  return [...pinned, ...rest]
}

/**
 * Whether two zone names are the same zone, an older alias counting as its current name: a pick of the account's own zone
 * is no change, and the device's row is the one whose zone the device reports under either name.
 * @example sameZone('Asia/Calcutta', 'Asia/Kolkata') // true
 */
export const sameZone = (a: string, b: string): boolean =>
  canonicalZone(a) === canonicalZone(b)

/** How a タイムゾーン sheet row shows: tagged この端末, checked as the account's zone, dimmed and not pressable. */
export type ZoneRowState = {
  onDevice: boolean
  checked: boolean
  dimmed: boolean
}

/**
 * A sheet row's tags against this device and the account. Before settings are read nothing is checked (the default zone is
 * not the account's) and every row is dimmed, so a press cannot write over a value not known yet; a zone this runtime cannot
 * format stays dimmed as well.
 * @param entry - The row's zone.
 * @param zones.device - This device's zone.
 * @param zones.stored - The account's zone (the optimistic one while a pick is saving, so the check moves at once).
 * @param zones.ready - The settings row has been read.
 * @example zoneRowState(zoneEntry('Asia/Tokyo', now), { device: 'Asia/Tokyo', stored: 'Asia/Tokyo', ready: true }) // { onDevice: true, checked: true, dimmed: false }
 */
export function zoneRowState(
  entry: ZoneEntry,
  zones: { device: string; stored: string; ready: boolean },
): ZoneRowState {
  return {
    onDevice: sameZone(entry.id, zones.device),
    checked: zones.ready && sameZone(entry.id, zones.stored),
    dimmed: !zones.ready || entry.offsetMs === null,
  }
}

/** A タイムゾーン sheet row's sub line and the name a screen reader says for it. */
export type ZoneOptionText = { sub: string; label: string }

/**
 * A row's sub line (`アメリカ合衆国 · UTC-4`) and its spoken name (`ニューヨーク、アメリカ合衆国、UTC-4`), never the raw id.
 * @param entry - The row's zone.
 * @param onDevice - The zone is this device's, which the row tags 「この端末」.
 * @returns For a zone this runtime cannot format, 「この端末では扱えません」 in place of the country and offset.
 * @example zoneOptionText(zoneEntry('Asia/Tokyo', now), true) // { sub: '日本 · UTC+9', label: '東京、日本、UTC+9、この端末' }
 */
export function zoneOptionText(
  entry: ZoneEntry,
  onDevice: boolean,
): ZoneOptionText {
  const facts =
    entry.offsetMs === null
      ? ['この端末では扱えません']
      : [entry.country, zoneOffsetLabel(entry.offsetMs)].filter(Boolean)
  return {
    sub: facts.join(' · '),
    label: [entry.city, ...facts, ...(onDevice ? ['この端末'] : [])].join('、'),
  }
}

/** The line under the タイムゾーン sheet's search after a pick: what it says, and whether it is the failure alert. */
export type PickStatus = { text: string; alert: boolean } | null

/**
 * The status line for the sheet's last pick, naming the city so a quick second look says which pick it was about.
 * @param status - The pick's mutation status.
 * @param zone - The zone the pick wrote, undefined before any pick.
 * @returns null before any pick; otherwise 変更しています… / 変更しました / 変更できませんでした (the alert).
 * @example pickStatus('error', 'America/New_York') // { text: 'ニューヨークに変更できませんでした。もう一度お試しください', alert: true }
 */
export function pickStatus(
  status: 'idle' | 'pending' | 'success' | 'error',
  zone: string | undefined,
): PickStatus {
  if (status === 'idle' || zone === undefined) return null
  const city = zoneLabel(zone)
  if (status === 'pending')
    return { text: `${city}に変更しています…`, alert: false }
  if (status === 'success')
    return { text: `${city}に変更しました`, alert: false }
  return {
    text: `${city}に変更できませんでした。もう一度お試しください`,
    alert: true,
  }
}
