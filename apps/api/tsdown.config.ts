import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/server.ts'],
  platform: 'node',
  // Emit `dist/server.js`, not `.mjs`: the package is already ESM and the PRE_DEPLOY job path is fixed (MVP-04).
  fixedExtension: false,
  // Workspace packages ship TypeScript sources that Node refuses to load from node_modules,
  // so they are inlined; every npm dependency stays external for `pnpm deploy --prod`.
  deps: { alwaysBundle: [/^@switch-time\//] },
})
