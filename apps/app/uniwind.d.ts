// Same content Uniwind generates as uniwind-types.d.ts on every Metro run (gitignored): `className` on the
// React Native props and the theme names for `Uniwind.setTheme`. Committed because `tsc` runs without Metro (CI).
/// <reference types="uniwind/types" />

declare module 'uniwind' {
  export interface UniwindConfig {
    themes: readonly ['light', 'dark']
  }
}

export {}
