/**
 * Header date in the design's `M月D日（曜）` form, in the device's local calendar.
 * @example formatDay(new Date(2026, 8, 9)) // '9月9日（水）'
 */
export function formatDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日（${'日月火水木金土'.charAt(date.getDay())}）`
}
