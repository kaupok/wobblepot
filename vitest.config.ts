import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // Belt-and-suspenders so JSX never falls back to classic runtime
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost' } }, // avoids URL/Location undefined errors
    setupFiles: ['./vitest.setup.ts'],
    globals: true, // or false if you prefer to import expect in tests
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'e2e/**'],
    // Set required environment variables for tests
    env: {
      NEXT_PUBLIC_APP_NAME: 'TestApp',
    },
    // quality-of-life defaults
    testTimeout: 10000,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/*.config.{ts,js,mjs}',
        '**/types/**',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
})
