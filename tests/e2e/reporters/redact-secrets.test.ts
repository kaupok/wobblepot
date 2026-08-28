// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import type { TestCase, TestResult } from '@playwright/test/reporter'
import { collectSecrets, redact, RedactSecretsReporter } from './redact-secrets'

describe('collectSecrets', () => {
  it('picks up the fixture credentials from the environment', () => {
    const secrets = collectSecrets({
      SMOKE_TEST_EMAIL: 'smoke+ci@wobblepot.dev',
      SMOKE_TEST_PASSWORD: 'smoke-ci-password-2026',
      FORGOT_PASSWORD_TEST_EMAIL: 'forgot+ci@wobblepot.dev',
      FORGOT_PASSWORD_TEST_PASSWORD: 'forgot-ci-password-2026',
    })

    expect(secrets).toHaveLength(4)
    expect(secrets).toContain('smoke-ci-password-2026')
  })

  it('ignores unset vars', () => {
    expect(collectSecrets({})).toEqual([])
  })

  // A 3-character "password" would match half the artifact and is not a secret
  // worth protecting — better to leave the file readable.
  it('ignores values too short to match safely', () => {
    expect(collectSecrets({ SMOKE_TEST_PASSWORD: 'short' })).toEqual([])
  })

  it('orders longest first so overlapping values redact fully', () => {
    const secrets = collectSecrets({
      SMOKE_TEST_EMAIL: 'smoke@wobblepot.dev',
      SMOKE_TEST_PASSWORD: 'smoke@wobblepot.dev-and-more',
    })

    expect(secrets[0]).toBe('smoke@wobblepot.dev-and-more')
  })

  it('de-duplicates when two vars share a value', () => {
    expect(
      collectSecrets({
        SMOKE_TEST_PASSWORD: 'same-password-value',
        FORGOT_PASSWORD_TEST_PASSWORD: 'same-password-value',
      }),
    ).toEqual(['same-password-value'])
  })
})

describe('redact', () => {
  // Mirrors the real leak: Playwright's page snapshot writes `input.value`
  // verbatim, so the password lands in `error-context.md` in cleartext.
  it('removes a password from a page snapshot', () => {
    const snapshot = [
      '- textbox "Email" [ref=e26]: smoke+ci@wobblepot.dev',
      '- textbox "Password" [ref=e31]: smoke-ci-password-2026',
    ].join('\n')

    const result = redact(snapshot, ['smoke-ci-password-2026', 'smoke+ci@wobblepot.dev'])

    expect(result).not.toContain('smoke-ci-password-2026')
    expect(result).not.toContain('smoke+ci@wobblepot.dev')
    expect(result).toContain('[redacted]')
    expect(result).toContain('- textbox "Password" [ref=e31]: [redacted]')
  })

  it('replaces every occurrence, not just the first', () => {
    const result = redact('p@ssword-value p@ssword-value', ['p@ssword-value'])

    expect(result).toBe('[redacted] [redacted]')
  })

  // Secrets are substituted literally, so a value containing regex
  // metacharacters must not be treated as a pattern.
  it('treats secrets as literals, not regexes', () => {
    const result = redact('value: a.b*c+d', ['a.b*c+d'])

    expect(result).toBe('value: [redacted]')
  })

  it('leaves content untouched when there are no secrets', () => {
    expect(redact('nothing to hide here', [])).toBe('nothing to hide here')
  })
})

describe('RedactSecretsReporter.onTestEnd', () => {
  const env = {
    SMOKE_TEST_EMAIL: 'smoke+ci@wobblepot.dev',
    SMOKE_TEST_PASSWORD: 'smoke-ci-password-2026',
  }

  /**
   * The shape Playwright actually writes on failure — a real `error-context.md`
   * from a staging-smoke run, minus the credentials.
   */
  const ERROR_CONTEXT = `# Test info

- Name: smoke.spec.ts >> Smoke >> seeded smoke user signs in and views profile

# Page snapshot

\`\`\`yaml
- textbox "Email" [ref=e26]: ${env.SMOKE_TEST_EMAIL}
- textbox "Password" [ref=e31]: ${env.SMOKE_TEST_PASSWORD}
- alert [ref=e32]: An unexpected error occurred. Please try again.
\`\`\`
`

  async function withTempFile(
    name: string,
    content: string,
    fn: (filePath: string) => Promise<void>,
  ): Promise<void> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redact-secrets-'))
    const filePath = path.join(dir, name)
    await fs.writeFile(filePath, content, 'utf8')
    try {
      await fn(filePath)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }

  function resultWith(attachments: TestResult['attachments']): TestResult {
    return { attachments } as TestResult
  }

  const testCase = {} as TestCase

  it('scrubs credentials out of an error-context.md on disk', async () => {
    await withTempFile('error-context.md', ERROR_CONTEXT, async (filePath) => {
      await new RedactSecretsReporter(env).onTestEnd(
        testCase,
        resultWith([{ name: 'error-context', contentType: 'text/markdown', path: filePath }]),
      )

      const after = await fs.readFile(filePath, 'utf8')
      expect(after).not.toContain(env.SMOKE_TEST_PASSWORD)
      expect(after).not.toContain(env.SMOKE_TEST_EMAIL)
      expect(after).toContain('- textbox "Password" [ref=e31]: [redacted]')
      // The diagnostic value of the artifact has to survive the scrub.
      expect(after).toContain('An unexpected error occurred')
    })
  })

  it('scrubs in-memory attachment bodies', async () => {
    const result = resultWith([
      {
        name: 'snapshot',
        contentType: 'text/markdown',
        body: Buffer.from(ERROR_CONTEXT, 'utf8'),
      },
    ])

    await new RedactSecretsReporter(env).onTestEnd(testCase, result)

    expect(result.attachments[0]!.body!.toString('utf8')).not.toContain(env.SMOKE_TEST_PASSWORD)
  })

  // Rewriting a PNG or trace zip as UTF-8 would corrupt it. `use.trace` in
  // playwright.config.ts is what keeps traces out of remote-tier artifacts.
  it('leaves binary attachments alone', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await withTempFile('test-failed-1.png', png.toString('binary'), async (filePath) => {
      const before = await fs.readFile(filePath)

      await new RedactSecretsReporter(env).onTestEnd(
        testCase,
        resultWith([{ name: 'screenshot', contentType: 'image/png', path: filePath }]),
      )

      expect(await fs.readFile(filePath)).toEqual(before)
    })
  })

  it('does not throw when an attachment path is missing', async () => {
    await expect(
      new RedactSecretsReporter(env).onTestEnd(
        testCase,
        resultWith([
          { name: 'error-context', contentType: 'text/markdown', path: '/nope/missing.md' },
        ]),
      ),
    ).resolves.toBeUndefined()
  })

  it('is a no-op when no credential env vars are set', async () => {
    await withTempFile('error-context.md', ERROR_CONTEXT, async (filePath) => {
      await new RedactSecretsReporter({}).onTestEnd(
        testCase,
        resultWith([{ name: 'error-context', contentType: 'text/markdown', path: filePath }]),
      )

      expect(await fs.readFile(filePath, 'utf8')).toBe(ERROR_CONTEXT)
    })
  })
})
