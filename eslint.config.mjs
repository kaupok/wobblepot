import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import testingLibrary from 'eslint-plugin-testing-library'
import storybook from 'eslint-plugin-storybook'

const config = defineConfig([
  // Next.js + TypeScript base rules (native flat config)
  ...nextVitals,
  ...nextTs,

  // WHY: ESLint 10 workaround (HON-313). `eslint-config-next` sets
  // `settings.react.version = 'detect'`, and eslint-plugin-react@7.37.5 resolves
  // that through the `context.getFilename()` API that ESLint 10 removed, so every
  // react rule throws `TypeError: contextOrFilename.getFilename is not a function`.
  // Pinning the version explicitly skips the auto-detection branch entirely.
  // REMOVE WHEN: eslint-plugin-react ships a release containing
  // https://github.com/jsx-eslint/eslint-plugin-react/pull/4022 and
  // eslint-config-next picks it up. Tracking: https://github.com/vercel/next.js/issues/89764
  // ALSO BUMP: on every React major. '19' coerces to 19.0.0, so version-gated react
  // rules would keep evaluating against 19.0.0 after React 20 lands. No effect today
  // (a full lint run at '19' vs '19.2.8' is byte-identical).
  {
    settings: { react: { version: '19' } },
  },

  // Global ignores
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'storybook-static/**',
    'next-env.d.ts',
    // Vendored: regenerated verbatim by `msw init public`. msw 2.15 added its own
    // `/* eslint-disable */` header, which ESLint 10 then reports as an unused
    // directive on every run.
    'public/mockServiceWorker.js',
  ]),

  // TypeScript-specific rules
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-console': 'warn',
      '@next/next/no-img-element': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // Testing Library rules (only for test files)
  {
    files: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    ignores: ['tests/e2e/**'],
    plugins: { 'testing-library': testingLibrary },
    rules: {
      'testing-library/await-async-queries': 'error',
      'testing-library/no-wait-for-side-effects': 'error',
      'testing-library/no-promise-in-fire-event': 'error',
      'testing-library/prefer-screen-queries': 'warn',
      'testing-library/no-node-access': 'warn',
      'testing-library/no-container': 'warn',
    },
  },

  // Storybook rules (only for story files)
  ...storybook.configs['flat/recommended'],
])

export default config
