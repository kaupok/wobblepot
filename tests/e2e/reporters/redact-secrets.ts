import fs from 'node:fs/promises'
import path from 'node:path'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

/**
 * Scrubs fixture credentials out of Playwright's text attachments before the
 * HTML reporter copies them into `playwright-report/`.
 *
 * Playwright writes an `error-context.md` for every failing test containing a
 * page snapshot, and that snapshot records `input.value` verbatim — including
 * `type="password"` fields, which the PNG screenshot correctly renders as dots.
 * On the remote smoke tiers those fields hold `SMOKE_TEST_PASSWORD` /
 * `FORGOT_PASSWORD_TEST_PASSWORD`, so a failing staging-smoke run published the
 * fixture credentials in cleartext inside a 14-day artifact that any repo
 * reader can download. GitHub's secret masking only covers log output, not
 * artifact file contents.
 *
 * The attachment is generated unconditionally on failure (see
 * `_takePageSnapshot` in playwright/lib/index.js) — there is no `use:` option
 * that turns it off — hence a reporter. `use.trace` in `playwright.config.ts`
 * handles the trace zip, which carries the same values in a form we cannot
 * text-scrub.
 *
 * Must be listed FIRST in `reporter` — the HTML reporter reads these files in
 * its `onEnd`, well after every `onTestEnd` has run.
 */

/** Env vars whose values must never survive into an artifact. */
const SECRET_ENV_VARS = [
  'SMOKE_TEST_PASSWORD',
  'SMOKE_TEST_EMAIL',
  'FORGOT_PASSWORD_TEST_PASSWORD',
  'FORGOT_PASSWORD_TEST_EMAIL',
  // Runner-only Resend read key (HON-479). Never appears in a page snapshot,
  // but it does travel in an Authorization header that a network log would
  // record, so keep it in the sweep.
  'RESEND_TEST_API_KEY',
] as const

const REDACTED = '[redacted]'

/**
 * Short values would match far too much unrelated text (and a 3-character
 * "password" is not a secret worth protecting), so skip them rather than
 * corrupting the artifact.
 */
const MIN_SECRET_LENGTH = 8

/** Attachment extensions we can safely rewrite as UTF-8 text. */
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.log', '.html'])

/** Loosened from `NodeJS.ProcessEnv` so tests can pass a bare literal. */
type EnvLike = Record<string, string | undefined>

export function collectSecrets(env: EnvLike = process.env): string[] {
  const values = SECRET_ENV_VARS.map((name) => env[name]).filter(
    (value): value is string => !!value && value.length >= MIN_SECRET_LENGTH,
  )
  // Longest first, so a value that contains another (e.g. an email that is a
  // prefix of a longer one) doesn't leave a partial match behind.
  return [...new Set(values)].sort((a, b) => b.length - a.length)
}

export function redact(content: string, secrets: readonly string[]): string {
  return secrets.reduce((acc, secret) => acc.split(secret).join(REDACTED), content)
}

export class RedactSecretsReporter implements Reporter {
  private readonly secrets: string[]

  constructor(env: EnvLike = process.env) {
    this.secrets = collectSecrets(env)
  }

  async onTestEnd(_test: TestCase, result: TestResult): Promise<void> {
    if (this.secrets.length === 0) return

    for (const attachment of result.attachments) {
      // In-memory attachments: rewrite the buffer the HTML reporter will read.
      if (attachment.body) {
        const original = attachment.body.toString('utf8')
        const scrubbed = redact(original, this.secrets)
        if (scrubbed !== original) attachment.body = Buffer.from(scrubbed, 'utf8')
        continue
      }

      if (!attachment.path) continue
      if (!TEXT_EXTENSIONS.has(path.extname(attachment.path).toLowerCase())) continue

      try {
        const original = await fs.readFile(attachment.path, 'utf8')
        const scrubbed = redact(original, this.secrets)
        if (scrubbed !== original) await fs.writeFile(attachment.path, scrubbed, 'utf8')
      } catch {
        // A missing or unreadable attachment must not fail the run. Worst case
        // the file stays as-is, which is the pre-existing behaviour.
      }
    }
  }
}

export default RedactSecretsReporter
