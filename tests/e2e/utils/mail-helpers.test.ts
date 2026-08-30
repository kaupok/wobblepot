import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractResetUrl, findRecentEmail, canReadEmail } from './mail-helpers'

/**
 * The Resend backend never runs in tier 1 CI (no `RESEND_TEST_API_KEY` there),
 * so without these tests a bug in the matching logic would only surface the
 * day someone provisions the key — on the staging promotion gate. Covered
 * here instead: link extraction, and the recipient / subject / send-time
 * filtering that keeps a stale reset link from satisfying a fresh run.
 */

const RESET_URL =
  'http://localhost:3000/api/auth/reset-password/abc123XYZ?callbackURL=%2Freset-password'

describe('extractResetUrl', () => {
  it('pulls the Better Auth reset link out of an HTML body', () => {
    const html = `<a href="${RESET_URL}" style="color:#fff">Reset password</a>`
    expect(extractResetUrl(html)).toBe(RESET_URL)
  })

  it('pulls it out of the plain-text body too', () => {
    expect(extractResetUrl(`Click the link below:\n${RESET_URL}\n\nExpires in 1 hour.`)).toBe(
      RESET_URL,
    )
  })

  it('ignores other links in the same body', () => {
    const html = `
      <a href="https://wobblepot.com/">Wobblepot</a>
      <a href="${RESET_URL}">Reset password</a>
      <a href="mailto:privacy@wobblepot.com">Contact</a>`
    expect(extractResetUrl(html)).toBe(RESET_URL)
  })

  it('decodes the &amp; an HTML body escapes query separators with', () => {
    const escaped = `<a href="https://app.example.com/api/auth/reset-password/tok?callbackURL=%2Fx&amp;foo=1">go</a>`
    expect(extractResetUrl(escaped)).toBe(
      'https://app.example.com/api/auth/reset-password/tok?callbackURL=%2Fx&foo=1',
    )
  })

  it('returns null when the body has no reset link', () => {
    expect(extractResetUrl('<a href="https://wobblepot.com/">Wobblepot</a>')).toBeNull()
  })
})

describe('findRecentEmail', () => {
  const originalKey = process.env.RESEND_TEST_API_KEY
  const originalFetch = globalThis.fetch

  const listResponse = (data: unknown[]) => ({
    ok: true,
    json: async () => ({ data }),
  })

  beforeEach(() => {
    process.env.RESEND_TEST_API_KEY = 're_test_key'
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
    if (originalKey === undefined) {
      delete process.env.RESEND_TEST_API_KEY
    } else {
      process.env.RESEND_TEST_API_KEY = originalKey
    }
  })

  it('canReadEmail reflects whether the runner key is set', () => {
    expect(canReadEmail()).toBe(true)
    delete process.env.RESEND_TEST_API_KEY
    expect(canReadEmail()).toBe(false)
  })

  it('returns the newest matching message and fetches its body', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/emails')) {
        return listResponse([
          {
            id: 'old',
            to: ['fixture@example.com'],
            subject: 'Reset your Wobblepot password',
            created_at: '2026-08-30 10:00:00.000000+00',
          },
          {
            id: 'new',
            to: ['Fixture@Example.com'],
            subject: '[Staging] Reset your Wobblepot password',
            created_at: '2026-08-30 10:05:00.000000+00',
          },
        ])
      }
      return { ok: true, json: async () => ({ id: 'new', html: `<a href="${RESET_URL}">go</a>` }) }
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const message = await findRecentEmail({
      recipient: 'fixture@example.com',
      subjectPattern: /reset your .+ password/i,
      sentAfter: new Date('2026-08-30T09:00:00Z'),
    })

    expect(message?.id).toBe('new')
    expect(fetchMock.mock.calls[1]![0]).toContain('/emails/new')
  })

  it('ignores messages sent before the run started', async () => {
    globalThis.fetch = vi.fn(async () =>
      listResponse([
        {
          id: 'stale',
          to: ['fixture@example.com'],
          subject: 'Reset your Wobblepot password',
          created_at: '2026-08-30 08:00:00.000000+00',
        },
      ]),
    ) as unknown as typeof fetch

    const promise = findRecentEmail({
      recipient: 'fixture@example.com',
      subjectPattern: /reset your .+ password/i,
      sentAfter: new Date('2026-08-30T10:00:00Z'),
    })
    // Poll budget is 10 × 2s; run it out without waiting in real time.
    await vi.runAllTimersAsync()

    expect(await promise).toBeNull()
  })

  it('ignores messages addressed to someone else', async () => {
    globalThis.fetch = vi.fn(async () =>
      listResponse([
        {
          id: 'other',
          to: ['someone-else@example.com'],
          subject: 'Reset your Wobblepot password',
          created_at: '2026-08-30 10:05:00.000000+00',
        },
      ]),
    ) as unknown as typeof fetch

    const promise = findRecentEmail({
      recipient: 'fixture@example.com',
      subjectPattern: /reset your .+ password/i,
      sentAfter: new Date('2026-08-30T09:00:00Z'),
    })
    await vi.runAllTimersAsync()

    expect(await promise).toBeNull()
  })

  it('ignores a non-matching subject (e.g. the deletion confirmation)', async () => {
    globalThis.fetch = vi.fn(async () =>
      listResponse([
        {
          id: 'deletion',
          to: ['fixture@example.com'],
          subject: 'Your Wobblepot account will be deleted on 30 September 2026',
          created_at: '2026-08-30 10:05:00.000000+00',
        },
      ]),
    ) as unknown as typeof fetch

    const promise = findRecentEmail({
      recipient: 'fixture@example.com',
      subjectPattern: /reset your .+ password/i,
      sentAfter: new Date('2026-08-30T09:00:00Z'),
    })
    await vi.runAllTimersAsync()

    expect(await promise).toBeNull()
  })

  it('surfaces a Resend auth failure instead of silently returning null', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'restricted',
    })) as unknown as typeof fetch

    await expect(
      findRecentEmail({
        recipient: 'fixture@example.com',
        subjectPattern: /reset/i,
        sentAfter: new Date(),
      }),
    ).rejects.toThrow(/status 401/)
  })
})
