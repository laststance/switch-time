import { expect, test } from 'vitest'

import { CATALOG_ZONES } from './time-zone-catalog'
import {
  canonicalZone,
  foldForSearch,
  pickStatus,
  sameZone,
  zoneCatalog,
  zoneChoices,
  zoneEntry,
  zoneLabel,
  zoneOffsetLabel,
  zoneOptionText,
  zoneRowState,
} from './time-zones'

// A northern-summer moment: New York on EDT (UTC-4), Sydney on AEST (UTC+10).
const NOW = new Date('2026-09-29T00:00:00Z')

const cities = (rows: { city: string }[]) => rows.map((row) => row.city)

test('a listed zone reads as its Japanese city on 設定 and in the sheet', () => {
  // Act & Assert
  expect(zoneLabel('America/New_York')).toBe('ニューヨーク')
  expect(zoneLabel('Asia/Tokyo')).toBe('東京')
  expect(zoneLabel('UTC')).toBe('協定世界時')
})

test('a zone without a Japanese name reads as its city in English, not as the raw IANA id', () => {
  // Act & Assert
  expect(zoneLabel('America/Argentina/Rio_Gallegos')).toBe('Rio Gallegos')
  expect(zoneLabel('Etc/GMT+5')).toBe('Etc/GMT+5')
})

test('an older zone name a device reports reads as the same city as the current name', () => {
  // Act & Assert
  expect(canonicalZone('Asia/Calcutta')).toBe('Asia/Kolkata')
  expect(zoneLabel('Asia/Calcutta')).toBe('コルカタ')
})

test('offsets read as UTC+9, UTC+5:30, UTC+5:45, UTC-3 and UTC±0', () => {
  // Act & Assert
  expect(zoneOffsetLabel(9 * 3_600_000)).toBe('UTC+9')
  expect(zoneOffsetLabel(5.5 * 3_600_000)).toBe('UTC+5:30')
  expect(zoneOffsetLabel(5.75 * 3_600_000)).toBe('UTC+5:45')
  expect(zoneOffsetLabel(-3 * 3_600_000)).toBe('UTC-3')
  expect(zoneOffsetLabel(0)).toBe('UTC±0')
})

test('the search reads hiragana as katakana, full-width letters as ASCII, and the id’s slashes and underscores as spaces', () => {
  // Act & Assert
  expect(foldForSearch('にゅーよーく')).toBe('ニューヨーク')
  expect(foldForSearch('ＮＥＷ')).toBe('new')
  expect(foldForSearch('America/New_York')).toBe('america new york')
})

test('before any search the sheet lists this device’s zone first, the account’s zone second, then the Japanese-named zones west to east', () => {
  // Arrange
  const catalog = zoneCatalog(NOW)

  // Act
  const rows = zoneChoices(
    catalog,
    { query: '', device: 'Asia/Tokyo', pinned: 'America/New_York' },
    NOW,
  )

  // Assert
  expect(cities(rows).slice(0, 4)).toEqual([
    '東京',
    'ニューヨーク',
    'パゴパゴ',
    'ホノルル',
  ])
  expect(rows).toHaveLength(71)
  expect(cities(rows)).not.toContain('Rio Gallegos')
})

test('a search by kanji, katakana, hiragana, country or English id finds the zone', () => {
  // Arrange
  const catalog = zoneCatalog(NOW)
  const search = (query: string) =>
    cities(
      zoneChoices(
        catalog,
        { query, device: 'Asia/Tokyo', pinned: 'Asia/Tokyo' },
        NOW,
      ),
    )

  // Act & Assert
  expect(search('上海')).toEqual(['上海'])
  expect(search('ニューヨーク')).toEqual(['ニューヨーク'])
  expect(search('にゅーよーく')).toEqual(['ニューヨーク'])
  expect(search('new york')).toEqual(['ニューヨーク'])
  expect(search('アルゼンチン')).toContain('Rio Gallegos')
})

test('a search that matches nothing leaves the list empty, pinned rows included', () => {
  // Arrange
  const catalog = zoneCatalog(NOW)

  // Act
  const rows = zoneChoices(
    catalog,
    { query: 'ぬぬぬ', device: 'Asia/Tokyo', pinned: 'America/New_York' },
    NOW,
  )

  // Assert
  expect(rows).toEqual([])
})

test('a device reporting an older zone name gets one row, not a second one under the current name', () => {
  // Arrange
  const catalog = zoneCatalog(NOW)

  // Act
  const rows = zoneChoices(
    catalog,
    { query: 'コルカタ', device: 'Asia/Calcutta', pinned: 'Asia/Tokyo' },
    NOW,
  )

  // Assert
  expect(rows.map((row) => row.id)).toEqual(['Asia/Kolkata'])
})

test('an account zone outside the catalog is still pinned under this device’s zone', () => {
  // Arrange
  const catalog = zoneCatalog(NOW)

  // Act
  const rows = zoneChoices(
    catalog,
    { query: '', device: 'Asia/Tokyo', pinned: 'Etc/GMT+5' },
    NOW,
  )

  // Assert
  expect(rows[1]).toMatchObject({
    id: 'Etc/GMT+5',
    city: 'Etc/GMT+5',
    country: 'UTC',
    offsetMs: -5 * 3_600_000,
  })
})

test('an account zone this runtime cannot format is pinned without an offset instead of breaking the sheet', () => {
  // Arrange
  const catalog = zoneCatalog(NOW)

  // Act
  const rows = zoneChoices(
    catalog,
    { query: '', device: 'Asia/Tokyo', pinned: 'Mars/Olympus' },
    NOW,
  )

  // Assert
  expect(rows[1]).toMatchObject({ id: 'Mars/Olympus', offsetMs: null })
  expect(zoneOptionText(rows[1]!, false)).toEqual({
    sub: 'この端末では扱えません',
    label: 'Olympus、この端末では扱えません',
  })
})

test('a row says its country and offset, and the device’s row says この端末 to a screen reader', () => {
  // Arrange
  const tokyo = zoneEntry('Asia/Tokyo', NOW)
  const newYork = zoneEntry('America/New_York', NOW)

  // Act & Assert
  expect(zoneOptionText(tokyo, true)).toEqual({
    sub: '日本 · UTC+9',
    label: '東京、日本、UTC+9、この端末',
  })
  expect(zoneOptionText(newYork, false)).toEqual({
    sub: 'アメリカ合衆国 · UTC-4',
    label: 'ニューヨーク、アメリカ合衆国、UTC-4',
  })
})

test('before settings are read no row is checked and every row is dimmed, so a press cannot write over an unknown zone', () => {
  // Arrange
  const tokyo = zoneEntry('Asia/Tokyo', NOW)

  // Act
  const state = zoneRowState(tokyo, {
    device: 'Asia/Tokyo',
    stored: 'Asia/Tokyo',
    ready: false,
  })

  // Assert
  expect(state).toEqual({ onDevice: true, checked: false, dimmed: true })
})

test('once settings are read the account’s zone is checked, even when the device names it by an older alias', () => {
  // Arrange
  const kolkata = zoneEntry('Asia/Kolkata', NOW)

  // Act
  const state = zoneRowState(kolkata, {
    device: 'Asia/Calcutta',
    stored: 'Asia/Calcutta',
    ready: true,
  })

  // Assert
  expect(state).toEqual({ onDevice: true, checked: true, dimmed: false })
  expect(sameZone('Asia/Calcutta', 'Asia/Kolkata')).toBe(true)
})

test('the line under the search says a pick is saving, saved, or failed, naming the city', () => {
  // Act & Assert
  expect(pickStatus('idle', undefined)).toBeNull()
  expect(pickStatus('pending', 'America/New_York')).toEqual({
    text: 'ニューヨークに変更しています…',
    alert: false,
  })
  expect(pickStatus('success', 'America/New_York')).toEqual({
    text: 'ニューヨークに変更しました',
    alert: false,
  })
  expect(pickStatus('error', 'America/New_York')).toEqual({
    text: 'ニューヨークに変更できませんでした。もう一度お試しください',
    alert: true,
  })
})

test('every catalog zone has a country for the search, and no zone is listed twice', () => {
  // Arrange
  const ids = CATALOG_ZONES.map(([id]) => id)

  // Act
  const withoutCountry = CATALOG_ZONES.filter(([, country]) => country === '')

  // Assert
  expect(withoutCountry).toEqual([])
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids).toHaveLength(418)
})
