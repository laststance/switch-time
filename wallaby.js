/**
 * Repo-root Wallaby entry so Start uses the root Vitest projects (app + shared). Triggered by Wallaby: Start in Cursor/VS Code.
 * @example Wallaby.js: Start → coverage dots on apps/app/src/lib/correction.test.ts
 */
export default function wallabyConfig() {
  return {
    autoDetect: true,
    name: 'switch-time',
    tests: {
      override: (testPatterns) =>
        // Playwright lives in apps/app/e2e (`*.spec.ts`); Vitest include is `*.test.ts`, this is a belt.
        testPatterns.filter((pattern) => !String(pattern).includes('/e2e/')),
    },
  }
}
