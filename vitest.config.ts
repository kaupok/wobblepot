import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { defineConfig, type TestUserConfig } from 'vitest/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Shared by the `unit` and `unit-node` projects, so the two cannot drift.
const unitTest = {
  setupFiles: ['./vitest.setup.ts'],
  globals: true,
  // Read by the `unit` project and by `unit-node` files with a jsdom pragma.
  environmentOptions: { jsdom: { url: 'http://localhost' } },
  // `tests/e2e/**/*.spec.ts` belongs to Playwright (see
  // `playwright.config.ts` → `testMatch`). Colocated `.test.ts` files
  // there are Vitest's, same split as everywhere else in the repo —
  // that's how the e2e harness itself (reporters, helpers) gets unit
  // tested without spinning up a browser.
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    'tests/e2e/**/*.spec.*',
    'e2e/**',
    '**/*.stories.*',
    // Database tests belong to the `unit-db` project, so `pnpm test` stays
    // green without a database (HON-1183, HON-1186).
    '**/*.db.test.*',
  ],
  env: {
    NODE_ENV: 'test',
    NEXT_PUBLIC_APP_NAME: 'TestApp',
    NEXT_PUBLIC_APP_ENV: 'test',
    BETTER_AUTH_SECRET: 'test-secret-key-at-least-32-characters-long-for-testing',
    ANTHROPIC_API_KEY: 'sk-ant-test-key-for-vitest',
    UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token',
    ADMIN_EMAIL: 'admin@example.com',
    // Run as production does (Vercel and CI are UTC). The shopping-list
    // routes build their reference day with runtime-local date helpers
    // and compare it in the household's zone, which only agrees on a
    // UTC runtime — west of UTC their tests shift by a day (HON-772).
    // Overrides a TZ set in the developer's shell.
    TZ: 'UTC',
  },
  testTimeout: 10000,
} satisfies TestUserConfig

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
    // Coverage is a root-level option (since Vitest 4); it applies when tests
    // are run with --coverage regardless of which project is selected.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'json', 'html', 'lcov'],
      // Vitest 5 matches these as globs relative to the project root, not as
      // substrings, so a bare `tests/` or `node_modules/` would match nothing.
      // `include` already limits coverage to `src/`.
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/*.config.{ts,js,mjs}',
        '**/types/**',
        '**/*.d.ts',
        // Storybook code (stories, scenarios, story helpers) and generated
        // Prisma output are not app source. Left in, they sit in the
        // denominator at ~0% and dragged reported line coverage from ~82% to
        // ~61% (HON-791).
        '**/*.stories.{ts,tsx}',
        'src/stories/**',
        'src/generated/**',
        // CI checks and tooling, not app source. `include` already leaves
        // them out; this line keeps them out if `include` ever widens.
        'scripts/**',
      ],
      // The measured level on `main` across `unit`, `unit-node` and `unit-db`,
      // rounded down (HON-1192). `pnpm test:coverage` fails under any of them,
      // and CI runs it. Raise each by at least one point a month; lower one only
      // in a PR that says why (`pnpm coverage:ratchet`, docs/DEPLOYMENT.md →
      // CI Pipeline).
      thresholds: {
        lines: 92,
        functions: 89,
        branches: 87,
        statements: 92,
      },
    },
    projects: [
      // `.tsx` files render components, so they run in jsdom. `.ts` files run
      // in node, where a file skips the cost of booting a window it never
      // uses (HON-1178). A `.ts` file that needs a DOM opts back in with a
      // `// @vitest-environment jsdom` pragma on its first line.
      {
        extends: true,
        test: {
          ...unitTest,
          name: 'unit',
          environment: 'jsdom',
          include: ['**/*.{test,spec}.?(c|m)[jt]sx'],
        },
      },
      {
        extends: true,
        test: {
          ...unitTest,
          name: 'unit-node',
          environment: 'node',
          include: ['**/*.{test,spec}.?(c|m)[jt]s'],
        },
      },
      // `*.db.test.ts` files run real queries against PGlite, an in-process
      // Postgres (HON-1186). `src/test/db-setup.ts` applies `prisma/migrations`
      // once per run and resets the tables before each test. One worker with
      // `isolate: false`, so that one database serves every file in the run.
      // `pnpm test:db` runs this project alone.
      {
        extends: true,
        resolve: {
          alias: {
            // A `src/lib` read that formats copy calls `getTranslations` with
            // the household's locale; the shim answers from the real catalogs
            // (HON-1208).
            'next-intl/server': path.resolve(dirname, './src/test/next-intl-server-shim.ts'),
          },
        },
        test: {
          name: 'unit-db',
          environment: 'node',
          include: ['**/*.db.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          setupFiles: ['./src/test/db-setup.ts'],
          globals: true,
          pool: 'forks',
          fileParallelism: false,
          isolate: false,
          // Runs after `unit` and `unit-node` when one run selects all three
          // (`pnpm test:coverage`): Vitest refuses to share a group between
          // projects with different `maxWorkers`.
          sequence: { groupOrder: 1 },
          env: {
            ...unitTest.env,
            // A closed port: a client that bypasses PGlite fails here instead
            // of reaching a real database.
            DATABASE_URL: 'postgresql://unit-db@127.0.0.1:9/unit_db',
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
            // WHY: Playwright launches headless Chromium with --hide-scrollbars, which
            // zeroes the scrollbar width and turns the HON-690 scroll-lock guard in
            // select.stories.tsx into a no-op. Showing classic scrollbars makes it live.
            provider: playwright({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['./.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
})
