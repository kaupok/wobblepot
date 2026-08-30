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
  // CI runs 1 worker against a prebuilt `next start`. Locally the default
  // (`undefined` → ~50% of cores) fanned several workers at a single-process
  // `next dev`, so their sign-ups queued on one event loop behind the serial
  // HIBP + scrypt + Neon work and blew the 30s budget (HON-569). Cap local
  // parallelism to 2 to bound that contention; override with `--workers=N`.
  // Remote tiers run from a laptop (PLAYWRIGHT_BASE_URL) hit a real deployment,
  // not a single-process dev server, so they keep Playwright's default.
  workers: isCI ? 1 : remoteBaseURL ? undefined : 2,
  use: {
    baseURL: remoteBaseURL ?? localBaseURL ?? 'http://localhost:3000',
    // `retain-on-failure` captures traces + screenshots for every
    // failing test so `test-results/` has data even when a step is
    // killed mid-run (more useful than `on-first-retry` when CI is
    // still stabilising — see HON-518).
    //
    // Remote tiers are the exception, because a failing run there published
    // the fixture credentials in cleartext inside a 14-day artifact any repo
    // reader could download — GitHub secret masking does not reach inside
    // artifact file contents. Two independent leaks, both confirmed by
    // unzipping a real staging-smoke artifact:
    //
    //   1. Playwright's page snapshot records `input.value` verbatim, including
    //      `type="password"` fields that the PNG screenshot correctly renders
    //      as dots. It lands in `error-context.md` and inside the trace.
    //   2. The trace's `0-trace.network` carries full request bodies, so the
    //      sign-in POST payload holds the password whether or not the snapshot
    //      does.
    //
    // (1) is text, so the `redact-secrets` reporter below scrubs it. (2) lives
    // in a zip that cannot be text-scrubbed, so drop the trace entirely on
    // remote tiers. Screenshots stay on: they are masked, and they are the most
    // useful single artifact.
    //
    // Set `E2E_KEEP_TRACES=1` to opt back in when debugging a remote failure.
    // What it produces is credential-bearing — do not upload it as a CI
    // artifact, and delete it when you are done.
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
