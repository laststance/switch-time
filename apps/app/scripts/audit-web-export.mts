/// <reference types="node" />
// Guards the web export (`expo export -p web`): react-native-web cannot draw some CSS, and every colour must be a
// design-system/theme.json token or palette entry. Runs as `pnpm --filter app audit:web` after `build:web`, in CI too.
import fs from 'node:fs'
import path from 'node:path'

const appDir = path.resolve(import.meta.dirname, '..')
const theme = JSON.parse(
  fs.readFileSync(path.join(appDir, '../../design-system/theme.json'), 'utf8'),
) as {
  colorSchemes: Record<string, Record<string, string>>
  activityPalette: string[]
}

/** `#abc` / `#abcd` / `#aabbcc` / `#aabbccdd` → 6- or 8-digit uppercase, so one colour spelled two ways compares equal. */
const normalizeHex = (hex: string) => {
  const digits = hex.slice(1)
  const long =
    digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits
  return `#${long.toUpperCase()}`
}

/** `rgba(242,239,232,0.60)` → `#F2EFE899`: lightningcss rewrites the token's rgba() into hex-with-alpha in the export. */
const rgbaToHex = (value: string) => {
  const [r, g, b, a = '1'] = value.replace(/rgba?\(|\)|\s/g, '').split(',')
  const channel = (n: string) =>
    Math.round(Number(n)).toString(16).padStart(2, '0')
  const alpha = Number(a) === 1 ? '' : channel(String(Number(a) * 255))
  return normalizeHex(`#${channel(r!)}${channel(g!)}${channel(b!)}${alpha}`)
}

const allowed = new Set(
  [
    ...Object.values(theme.colorSchemes).flatMap((scheme) =>
      Object.values(scheme),
    ),
    ...theme.activityPalette,
    '#fff', // `text-white` on the active switch button label
    '#0000', // transparent, Tailwind's own default for shadows and reset backgrounds
  ].map((value) =>
    value.startsWith('#') ? normalizeHex(value) : rgbaToHex(value),
  ),
)

const banned: [label: string, pattern: RegExp][] = [
  ['display: grid', /display:\s*grid/],
  ['position: sticky', /position:\s*sticky/],
  ['backdrop-filter', /backdrop-filter/],
  ['filter', /[;{]filter:/],
  ['linear-gradient', /linear-gradient\(/],
  ['::before / ::after', /::?(before|after)\b/],
]

const problems: string[] = []
const cssFiles = fs.globSync('dist/**/*.css', { cwd: appDir })
if (cssFiles.length === 0)
  problems.push('no CSS in dist/: run `pnpm --filter app build:web` first')

for (const file of cssFiles) {
  const css = fs.readFileSync(path.join(appDir, file), 'utf8')
  // Tailwind's own reset (`@layer base` / `@layer properties`) names `:before,:after`; that selector list is not app CSS.
  const authored = css.replaceAll(
    /\*,:(?:before|after),:(?:before|after),::backdrop/g,
    '',
  )
  for (const [label, pattern] of banned) {
    if (pattern.test(authored))
      problems.push(`${file}: banned for web: ${label}`)
  }
}

// Hex audit: the export's CSS plus the app sources (inline styles, JSDoc examples, tokens).
const sources = [
  ...cssFiles,
  ...fs.globSync('src/**/*.{ts,tsx,css}', { cwd: appDir }),
]
for (const file of sources) {
  const text = fs.readFileSync(path.join(appDir, file), 'utf8')
  for (const hex of new Set(text.match(/#[0-9a-f]{3,8}\b/gi) ?? [])) {
    if (!allowed.has(normalizeHex(hex)))
      problems.push(`${file}: ${hex} is not a theme.json colour`)
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(
  `audit:web ok (${cssFiles.length} css, ${sources.length - cssFiles.length} source files, ${allowed.size} allowed colours)`,
)
