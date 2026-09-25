import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

import theme from '../../../../design-system/theme.json'

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

/** `#rrggbb` or `rgba(r, g, b, a)` as numbers, so copies of a colour written differently (`0.60`, `0.6`) compare equal. */
function channels(value: string): [number, number, number, number] {
  const hexChannel = (index: number) =>
    parseInt(value.slice(1 + 2 * index, 3 + 2 * index), 16)
  if (value.startsWith('#'))
    return [hexChannel(0), hexChannel(1), hexChannel(2), 1]
  const [red = 0, green = 0, blue = 0, alpha = 1] = value
    .replace(/[^\d.,]/g, '')
    .split(',')
    .map(Number)
  return [red, green, blue, alpha]
}

/** `#rrggbb` or `rgba(r, g, b, a)` as the opaque colour it shows over `under`. */
function paint(value: string, under: Rgb): Rgb {
  const [red, green, blue, alpha] = channels(value)
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

/** A theme.json colour scheme re-keyed like {@link band} (`sheetBg` → `sheet-bg`), each value as {@link channels}. */
function designBand(name: 'dark' | 'light') {
  return Object.fromEntries(
    Object.entries(theme.colorSchemes[name]).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      channels(value),
    ]),
  )
}

/** The same band read from global.css, each value as {@link channels}. */
function appBand(name: 'dark' | 'light') {
  return Object.fromEntries(
    Object.entries(band(name)).map(([key, value]) => [key, channels(value)]),
  )
}

// The design system's stylesheet: dark on `:root`, light under `[data-theme="light"]`.
const STYLES = readFileSync(
  new URL('../../../../design-system/styles.css', import.meta.url),
  'utf8',
)

/** One styles.css theme block's `--color-*` values, each as {@link channels}. */
function stylesBand(name: 'dark' | 'light') {
  const opener = name === 'dark' ? ':root {' : '[data-theme="light"] {'
  const body = STYLES.split(opener)[1]?.split('}')[0] ?? ''
  return Object.fromEntries(
    [...body.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      channels(match[2] ?? ''),
    ]),
  )
}

test('design-system/styles.css carries the light colour tokens of theme.json, so the specimen pages match the app', () => {
  // Arrange / Act
  const styles = stylesBand('light')

  // Assert
  expect(styles).toEqual(designBand('light'))
})

test('design-system/styles.css carries the dark colour tokens of theme.json, so the specimen pages match the app', () => {
  // Arrange / Act
  const styles = stylesBand('dark')

  // Assert
  expect(styles).toEqual(designBand('dark'))
})

test('the app ships the light colour tokens of design-system/theme.json, so a token edit cannot skip the app', () => {
  // Arrange / Act
  const app = appBand('light')

  // Assert
  expect(app).toEqual(designBand('light'))
})

test('the app ships the dark colour tokens of design-system/theme.json, so a token edit cannot skip the app', () => {
  // Arrange / Act
  const app = appBand('dark')

  // Assert
  expect(app).toEqual(designBand('dark'))
})
