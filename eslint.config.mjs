import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'
import testingLibrary from 'eslint-plugin-testing-library'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const config = [
  // Next.js + TypeScript base rules (via compat)
  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  // Global ignores
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
      'cyrus-proxy/**', // Third-party Cyrus proxy worker code
    ],
  },

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
]

export default config
