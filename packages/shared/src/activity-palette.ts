/**
 * The 8 activity colours users cycle through in the Activity editor.
 * Mirrors `design-system/theme.json#activityPalette` (order matters: "cycle colour" walks this list);
 * {@link ACTIVITY_PALETTE} is pinned to the JSON by `activity-palette.test.ts`.
 * @example
 * ACTIVITY_PALETTE[0] // '#E0A431' (家事)
 */
export const ACTIVITY_PALETTE = [
  '#E0A431',
  '#3B7BD9',
  '#4FA877',
  '#6C63D6',
  '#E0684A',
  '#D8579C',
  '#2BA3B5',
  '#8A6A4B',
] as const

export type ActivityColor = (typeof ACTIVITY_PALETTE)[number]

export type DefaultActivity = {
  /** Stable key used as the seed id and the icon lookup key. */
  id: string
  /** Japanese display name shown on the switch button. */
  name: string
  color: ActivityColor
  iconKey: string
  /** Daily target in hours, shown as the ring/target line on History. */
  target: number
}

/**
 * Activities seeded for every new account (Better Auth `user.create.after` hook, MVP-12).
 * Mirrors `design-system/theme.json#defaultActivities`; edit the JSON first, then this list.
 * @example
 * DEFAULT_ACTIVITIES.map((a) => a.name) // ['家事', '仕事', '休息', '睡眠', '食事', '娯楽']
 */
export const DEFAULT_ACTIVITIES = [
  { id: 'house', name: '家事', color: '#E0A431', iconKey: 'home', target: 1.5 },
  { id: 'work', name: '仕事', color: '#3B7BD9', iconKey: 'work', target: 8 },
  { id: 'rest', name: '休息', color: '#4FA877', iconKey: 'rest', target: 2 },
  { id: 'sleep', name: '睡眠', color: '#6C63D6', iconKey: 'sleep', target: 7 },
  { id: 'meal', name: '食事', color: '#E0684A', iconKey: 'meal', target: 1.5 },
  { id: 'fun', name: '娯楽', color: '#D8579C', iconKey: 'fun', target: 1.5 },
] as const satisfies readonly DefaultActivity[]
