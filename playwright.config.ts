import { defineConfig } from '@playwright/test'

const remoteBaseURL = process.env.PLAYWRIGHT_BASE_URL
const isCI = !!process.env.CI

// Resolved relative to this config file so the reporter loads the same way
// whichever directory Playwright is invoked from.
const redactSecretsReporter = './tests/e2e/reporters/redact-secrets.ts'

// Escape hatch for the remote-tier trace suppression in `use.trace` below.
const keepRemoteTraces =
  process.env.E2E_KEEP_TRACES === '1' || process.env.E2E_KEEP_TRACES === 'true'

// Set by scripts/e2e-local.sh (`pnpm test:e2e:local`): run against an isolated
// Neon branch via a dedicated dev server on its own port. We must NOT reuse a
// hand-run :3000 server — that one loads .env and points at the real dev DB,
// silently defeating the isolation. A separate port also lets a normal
// `pnpm dev` keep running on :3000 alongside the test run.
const localPort = process.env.E2E_LOCAL_PORT
const localBaseURL = localPort ? `http://localhost:${localPort}` : undefined

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
    : localPort
      ? {
          command: `pnpm exec next dev --port ${localPort}`,
          url: localBaseURL,
          reuseExistingServer: false,
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
    baseURL: remoteBaseURL ?? localBaseURL ?? 'http://localhost:3000',
    // `retain-on-failure` captures traces + screenshots for every
    // failing test so `test-results/` has data even when a step is
    // killed mid-run (more useful than `on-first-retry` when CI is
    // still stabilising — see HON-518).
    //
    // Remote tiers are the exception. The trace embeds Playwright's page
    // snapshot, which records `input.value` verbatim — including
    // `type="password"` fields, which the PNG screenshot correctly renders as
    // dots. On preview-smoke and staging-smoke those fields hold
    // `SMOKE_TEST_PASSWORD` / `FORGOT_PASSWORD_TEST_PASSWORD`, so a failing run
    // published the fixture credentials in cleartext inside a 14-day artifact
    // any repo reader can download — GitHub secret masking does not reach
    // inside artifact file contents. A zip is not text-scrubbable, so drop it;
    // the `redact-secrets` reporter below handles the text attachments (the
    // same snapshot also lands in `error-context.md`), and screenshots stay on
    // because they are masked and the most useful single artifact.
    //
    // Set `E2E_KEEP_TRACES=1` to opt back in when debugging a remote failure,
    // and treat what it produces as credential-bearing.
    trace: remoteBaseURL && !keepRemoteTraces ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer,
  timeout: isCI ? 60_000 : 30_000,
  // `redact-secrets` must come before `html`: it scrubs fixture credentials out
  // of text attachments in `onTestEnd`, and `html` copies them in `onEnd`.
  // `list` goes next so CI gets per-test progress streamed to stdout (otherwise
  // `github` buffers everything and a hung suite prints nothing before the job
  // is killed).
  reporter: isCI
    ? [[redactSecretsReporter], ['list'], ['github'], ['html']]
    : [[redactSecretsReporter], ['list']],
})
