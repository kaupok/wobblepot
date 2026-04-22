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
  // Retries masked how broken the suite is — every sign-up test fails
  // three times in a row at exactly 60s. Dropping retries in CI while
  // we triage cuts wall-clock ~3× so the whole run fits in the step
  // timeout and we can see the full failure shape.
  retries: 0,
  workers: isCI ? 1 : undefined,
  use: {
    baseURL: remoteBaseURL ?? 'http://localhost:3000',
    // `retain-on-failure` captures traces + screenshots for every
    // failing test, not just retries, so `test-results/` has data
    // even when the step is killed mid-run.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer,
  timeout: isCI ? 60_000 : 30_000,
  // `list` goes first so CI gets per-test progress streamed to stdout
  // (otherwise `github` buffers everything and a hung suite prints nothing
  // before the job is killed).
  reporter: isCI ? [['list'], ['github'], ['html']] : [['list']],
})
