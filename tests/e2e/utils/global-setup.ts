import type { FullConfig } from '@playwright/test'

/**
 * Cold-start warm-up for the Playwright suite. Addresses HON-520: the first
 * test that exercises the sign-in *error response* path (`auth.spec.ts` →
 * `invalid credentials show error message`) consistently times out at the
 * 60 s per-test budget on a freshly-built `pnpm start` server, then passes
 * in 4–5 s on retry. Tests 1–3 warm sign-up + sign-in success but never the
 * failure branch, so test 4 pays the JIT / module-load cost inside its own
 * timeout window.
 *
 * This setup hits the two endpoints that test 4 was the first to touch
 * before any spec runs, so the cold cost lands here (where there is no
 * per-test budget) instead of inside a test.
 *
 * Per-call timing is logged so the first CI run with this setup doubles as
 * the diagnostic record (which endpoint actually paid the 55 s on cold).
 */

const WARMUP_TIMEOUT_MS = 90_000

const WARMUP_EMAIL = 'warmup-nonexistent@example.test'
const WARMUP_PASSWORD = 'warmup-not-a-real-password-2026'

interface WarmupTarget {
  label: string
  init: RequestInit
  path: string
}

const TARGETS: ReadonlyArray<WarmupTarget> = [
  {
    label: 'GET /api/auth/get-session',
    path: '/api/auth/get-session',
    init: { method: 'GET' },
  },
  {
    label: 'POST /api/auth/sign-in/email (bogus creds)',
    path: '/api/auth/sign-in/email',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: WARMUP_EMAIL, password: WARMUP_PASSWORD }),
    },
  },
]

async function warmEndpoint(baseURL: string, target: WarmupTarget): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS)
  const start = Date.now()
  try {
    const response = await fetch(`${baseURL}${target.path}`, {
      ...target.init,
      signal: controller.signal,
    })
    // Drain the body so the connection can be reused for any follow-up.
    await response.text()
    // eslint-disable-next-line no-console
    console.log(`[global-setup] ${target.label} → ${response.status} in ${Date.now() - start}ms`)
  } catch (error) {
    const elapsed = Date.now() - start
    const reason = error instanceof Error ? error.message : String(error)
    // eslint-disable-next-line no-console
    console.warn(
      `[global-setup] ${target.label} failed after ${elapsed}ms: ${reason}. ` +
        'Continuing — warm-up failure should not block the suite.',
    )
  } finally {
    clearTimeout(timer)
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // Skip warm-up against remote URLs. Preview-smoke / staging-smoke run
  // against shared environments where (a) there is no cold-start to warm and
  // (b) a junk POST would charge against the real abuse-protection limiter.
  if (process.env.PLAYWRIGHT_BASE_URL) {
    return
  }

  const project = config.projects[0]
  const baseURL = (project?.use?.baseURL as string | undefined) ?? 'http://localhost:3000'

  // eslint-disable-next-line no-console
  console.log(`[global-setup] Warming auth endpoints at ${baseURL}…`)
  const overall = Date.now()

  for (const target of TARGETS) {
    await warmEndpoint(baseURL, target)
  }

  // eslint-disable-next-line no-console
  console.log(`[global-setup] Warm-up complete in ${Date.now() - overall}ms`)
}
