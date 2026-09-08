import lastStanceReactNext from '@laststance/react-next-eslint-plugin'
import { defineConfig } from 'eslint/config'
import tsPrefixer from 'eslint-config-ts-prefixer'
import reactHooks from 'eslint-plugin-react-hooks'

export default defineConfig([
  {
    ignores: [
      // Design sources are pulled/generated artifacts, not application code.
      'design/**',
      'design-system/**',
      '**/dist/**',
      '**/.expo/**',
      'coverage/**',
      '.artifacts/**',
      '.fallow/**',
    ],
  },
  ...tsPrefixer,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  // React surfaces (apps/app + any .tsx). React Compiler is enabled
  // (`experiments.reactCompiler` in app.json), so we take the plugin's
  // "React Compiler Setup": manual memoization rules are omitted on purpose.
  {
    files: ['**/*.tsx', 'apps/app/**/*.ts'],
    plugins: {
      'react-hooks': reactHooks,
      '@laststance/react-next': lastStanceReactNext,
    },
    rules: {
      // v7 recommended includes the React Compiler-powered rules.
      ...reactHooks.configs.flat.recommended.rules,
      '@laststance/react-next/no-jsx-without-return': 'error',
      '@laststance/react-next/no-use-reducer': 'error',
      '@laststance/react-next/no-react-context': 'error',
      '@laststance/react-next/no-prop-drilling': 'error',
      '@laststance/react-next/no-set-state-prop-drilling': [
        'error',
        { depth: 1 },
      ],
      '@laststance/react-next/no-deopt-use-callback': 'error',
      '@laststance/react-next/no-deopt-use-memo': 'error',
      '@laststance/react-next/no-direct-use-effect': 'error',
      '@laststance/react-next/no-forward-ref': 'error',
      '@laststance/react-next/no-context-provider': 'error',
      '@laststance/react-next/no-missing-key': 'error',
      '@laststance/react-next/no-duplicate-key': 'error',
      '@laststance/react-next/jsx-no-useless-fragment': 'error',
      '@laststance/react-next/no-jsx-iife': 'error',
      '@laststance/react-next/no-missing-component-display-name': 'error',
      '@laststance/react-next/no-nested-component-definitions': 'error',
      '@laststance/react-next/no-missing-button-type': 'error',
    },
  },
])
