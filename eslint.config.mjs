import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import testingLibrary from 'eslint-plugin-testing-library'

const config = defineConfig([
  // Next.js + TypeScript base rules (native flat config)
  ...nextVitals,
  ...nextTs,

  // Global ignores
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    'cyrus-proxy/**', // Third-party Cyrus proxy worker code
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
])

export default config
