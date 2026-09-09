/**
 * Hand rotations in degrees for the dial: hours sweep with the minutes, minutes with the seconds, as on a real movement.
 * @example handAngles(new Date(2026, 8, 9, 3, 30, 0)) // { hour: 105, minute: 180, second: 0 }
 */
export function handAngles(date: Date): {
  hour: number
  minute: number
  second: number
} {
  const seconds = date.getSeconds()
  const minutes = date.getMinutes() + seconds / 60
  return {
    hour: ((date.getHours() % 12) + minutes / 60) * 30,
    minute: minutes * 6,
    second: seconds * 6,
  }
}
