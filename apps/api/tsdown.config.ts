import { defineConfig } from 'tsdown'

export default defineConfig({
  // `db/migrate` keeps its folder: the PRE_DEPLOY job runs `node dist/db/migrate.js`.
  entry: { server: 'src/server.ts', 'db/migrate': 'src/db/migrate.ts' },
  platform: 'node',
  // Emit `.js`, not `.mjs`: the package is already ESM and the PRE_DEPLOY job path is fixed.
  fixedExtension: false,
  // Workspace packages ship TypeScript sources that Node refuses to load from node_modules,
  // so they are inlined; every npm dependency stays external for `pnpm deploy --prod`.
  deps: { alwaysBundle: [/^@switch-time\//] },
})
