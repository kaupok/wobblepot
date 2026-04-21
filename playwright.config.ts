import { defineConfig } from '@playwright/test'

const remoteBaseURL = process.env.PLAYWRIGHT_BASE_URL
const isCI = !!process.env.CI

// When PLAYWRIGHT_BASE_URL is set (preview-smoke / staging-smoke tiers), skip
// the local webServer and run against the remote URL. Otherwise start a server:
// `pnpm build && pnpm start` in CI (matches prod build), `pnpm dev` locally.
const webServer = remoteBaseURL
  ? undefined
  : isCI
    ? {
        command: 'pnpm build && pnpm start',
        url: 'http://localhost:3000',
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'ignore' as const,
        stderr: 'pipe' as const,
      }
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        stdout: 'ignore' as const,
        stderr: 'pipe' as const,
      }

export default defineConfig({
  testDir: 'tests/e2e', // <-- only look here
  testMatch: ['**/*.spec.ts'], // <-- only *.spec.ts
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  use: {
    baseURL: remoteBaseURL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer,
  timeout: isCI ? 60_000 : 30_000,
  reporter: isCI ? [['github'], ['html']] : [['list']],
})
