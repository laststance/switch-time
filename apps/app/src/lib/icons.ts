const HOME = 'M3 11 12 3l9 8v10H3z'

// Activity glyphs from the design (ST Web ICONS), keyed by `activities.iconKey`.
const ICONS: Record<string, string> = {
  home: HOME,
  work: 'M3 8h18v12H3zM9 8V5h6v3M3 13h18',
  rest: 'M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM16 11h2a2 2 0 0 1 0 4h-2M7 3v3M11 3v3',
  sleep: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  meal: 'M7 3v18M4 3v5a3 3 0 0 0 6 0V3M16 3c-2 2-2 8 0 10v8M16 13c2-2 3-6 2-10',
  fun: 'M6 8h12a4 4 0 0 1 4 4v3a3 3 0 0 1-5.5 1.5L15 15H9l-1.5 1.5A3 3 0 0 1 2 15v-3a4 4 0 0 1 4-4zM7 11v3M5.5 12.5h3M16 12h.01M18 13.5h.01',
}

const ICON_KEYS = Object.keys(ICONS)

/**
 * The glyph after `iconKey` in the design's order (the editor's icon tap), wrapping; an unknown key restarts at the house.
 * @example cycleIcon('home') // 'work'
 */
export const cycleIcon = (iconKey: string): string =>
  ICON_KEYS[(ICON_KEYS.indexOf(iconKey) + 1) % ICON_KEYS.length] ?? 'home'

/** The 訂正 pencil: the header pill on ホーム and the 「記録を訂正する」 button on 記録. */
export const PENCIL = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'

/** The 「未使用日の扱い」 footnote's info circle. */
export const INFO = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01'

/**
 * Stroke path for an activity's `iconKey`; an unknown key (a renamed custom activity) still draws as the house.
 * @example <StrokeIcon d={activityIcon('work')} size={20} strokeWidth={2} color={ink} />
 */
export const activityIcon = (iconKey: string): string => ICONS[iconKey] ?? HOME
