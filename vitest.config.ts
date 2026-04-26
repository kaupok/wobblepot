import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { defineConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },

  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
      // Shim `import 'server-only'` — Next.js ships it at runtime, but Vite
      // can't resolve it in the unit test environment. The shim is a no-op
      // because `server-only` only exists to throw in client bundles.
      'server-only': path.resolve(dirname, './src/test/server-only-shim.ts'),
    },
  },

  test: {
    // Coverage is a root-level option in Vitest 4; it applies when tests are
    // run with --coverage regardless of which project is selected.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
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
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          environmentOptions: { jsdom: { url: 'http://localhost' } },
          setupFiles: ['./vitest.setup.ts'],
          globals: true,
          include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'e2e/**', '**/*.stories.*'],
          env: {
            NODE_ENV: 'test',
            NEXT_PUBLIC_APP_NAME: 'TestApp',
            NEXT_PUBLIC_APP_ENV: 'test',
            BETTER_AUTH_SECRET: 'test-secret-key-at-least-32-characters-long-for-testing',
            ANTHROPIC_API_KEY: 'sk-ant-test-key-for-vitest',
            UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
            UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token',
            ADMIN_EMAIL: 'admin@example.com',
          },
          testTimeout: 10000,
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
            storybookScript: 'pnpm storybook --no-open',
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            provider: playwright({}),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['./.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
})
