import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

// The shipped token values, read from the file Uniwind compiles, so a later edit to a colour is checked against WCAG.
const CSS = readFileSync(new URL('../global.css', import.meta.url), 'utf8')

type Rgb = [number, number, number]

/** One `@variant <band> { ... }` block's `--color-*` values, keyed by name without the prefix. */
function band(name: 'dark' | 'light'): Record<string, string> {
  const body =
    CSS.split(`@variant ${name} {`)[1]?.split('@variant web')[0] ?? ''
  return Object.fromEntries(
    [...body.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2],
    ]),
  )
}

/** `#rrggbb` or `rgba(r, g, b, a)` as the opaque colour it shows over `under`. */
function paint(value: string, under: Rgb): Rgb {
  const hexChannel = (index: number) =>
    parseInt(value.slice(1 + 2 * index, 3 + 2 * index), 16)
  if (value.startsWith('#'))
    return [hexChannel(0), hexChannel(1), hexChannel(2)]
  const [red = 0, green = 0, blue = 0, alpha = 1] = value
    .replace(/[^\d.,]/g, '')
    .split(',')
    .map(Number)
  const mix = (top: number, bottom: number) =>
    top * alpha + bottom * (1 - alpha)
  return [mix(red, under[0]), mix(green, under[1]), mix(blue, under[2])]
}

/** WCAG 2 contrast ratio of two opaque colours. */
function contrast(first: Rgb, second: Rgb): number {
  const linear = (channel: number) => {
    const scaled = channel / 255
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4
  }
  const luminance = ([red, green, blue]: Rgb) =>
    0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (left, right) => right - left,
  )
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

/** The lowest contrast of `sub` text over each surface, bare and under a `chip` fill. */
function lowestSubContrast(name: 'dark' | 'light'): number {
  const tokens = band(name)
  // A renamed token must fail loudly, not compare a missing colour.
  const token = (key: string) => {
    const value = tokens[key]
    if (value === undefined)
      throw new Error(`--color-${key} missing in ${name}`)
    return value
  }
  const surfaces = ['bg', 'face', 'surface', 'sheet-bg'].map((key) =>
    paint(token(key), [0, 0, 0]),
  )
  const grounds = surfaces.flatMap((surface) => [
    surface,
    paint(token('chip'), surface),
  ])
  return Math.min(
    ...grounds.map((ground) => contrast(paint(token('sub'), ground), ground)),
  )
}

test('secondary text stays readable (WCAG AA) on every light surface and chip', () => {
  // Arrange / Act
  const lowest = lowestSubContrast('light')

  // Assert
  expect(lowest).toBeGreaterThanOrEqual(4.5)
})

test('secondary text stays readable (WCAG AA) on every dark surface and chip', () => {
  // Arrange / Act
  const lowest = lowestSubContrast('dark')

  // Assert
  expect(lowest).toBeGreaterThanOrEqual(4.5)
})
