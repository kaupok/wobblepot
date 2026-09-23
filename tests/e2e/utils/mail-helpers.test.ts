import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractResetUrl, findRecentEmail, canReadEmail, resolveResetUrl } from './mail-helpers'

/**
 * The Resend backend never runs in tier 1 CI (no `RESEND_TEST_API_KEY` there),
 * so without these tests a bug in the matching logic would only surface the
 * day someone provisions the key — on the staging promotion gate. Covered
 * here instead: link extraction, the recipient / subject / body / send-time
 * filtering that keeps a stale reset link from satisfying a fresh run, and
 * reset-email selection that holds for every locale (HON-704).
 */

/** A spec that pins the recipient's locale may still match on the subject. */
const RESET_SUBJECT_EN = /^(\[Staging\] )?Reset your .+ password$/

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
      subjectPattern: RESET_SUBJECT_EN,
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
      subjectPattern: RESET_SUBJECT_EN,
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
      subjectPattern: RESET_SUBJECT_EN,
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
      subjectPattern: RESET_SUBJECT_EN,
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

describe('findRecentEmail by body', () => {
  const originalKey = process.env.RESEND_TEST_API_KEY
  const originalFetch = globalThis.fetch

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

  it('refuses to match on recipient and send time alone', async () => {
    await expect(
      findRecentEmail({ recipient: 'fixture@example.com', sentAfter: new Date() }),
    ).rejects.toThrow(/subjectPattern or a bodyMatches/)
  })

  it('fetches a rejected body once, not on every poll', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/emails')
        ? {
            ok: true,
            json: async () => ({
              data: [
                {
                  id: 'deletion',
                  to: ['fixture@example.com'],
                  subject: 'Your Wobblepot account will be deleted',
                  created_at: '2026-08-30 10:05:00.000000+00',
                },
              ],
            }),
          }
        : { ok: true, json: async () => ({ id: 'deletion', html: '<p>No link</p>' }) },
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const promise = findRecentEmail({
      recipient: 'fixture@example.com',
      bodyMatches: (detail) => extractResetUrl(detail.html ?? '') !== null,
      sentAfter: new Date('2026-08-30T09:00:00Z'),
    })
    await vi.runAllTimersAsync()

    expect(await promise).toBeNull()
    const detailCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith('/emails/deletion'))
    expect(detailCalls).toHaveLength(1)
  })
})

describe('resolveResetUrl (Resend backend)', () => {
  const originalKey = process.env.RESEND_TEST_API_KEY
  const originalFetch = globalThis.fetch

  type Stub = { id: string; subject: string; created_at: string; html: string; to?: string[] }

  /** Serves `stubs` as the Resend list, and each one's body from `/emails/{id}`. */
  function stubResend(stubs: Stub[]) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/emails')) {
        return {
          ok: true,
          json: async () => ({
            data: stubs.map(({ html: _html, to, ...email }) => ({
              ...email,
              to: to ?? ['fixture@example.com'],
            })),
          }),
        }
      }
      const stub = stubs.find((s) => url.endsWith(`/emails/${s.id}`))
      return { ok: true, json: async () => ({ ...stub, text: null }) }
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

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

  // The subject is whatever the household's locale renders; the helper must
  // not care. Estonian is the case HON-704 was filed for.
  it.each([
    ['English', 'Reset your Wobblepot password'],
    ['Estonian', 'Lähtesta oma Wobblepot parool'],
    ['Estonian on staging', '[Staging] Lähtesta oma Wobblepot parool'],
  ])('resolves the reset link from a %s subject', async (_label, subject) => {
    stubResend([
      {
        id: 'reset',
        subject,
        created_at: '2026-08-30 10:05:00.000000+00',
        html: `<a href="${RESET_URL}">go</a>`,
      },
    ])

    const url = await resolveResetUrl({
      email: 'fixture@example.com',
      requestedAt: new Date('2026-08-30T10:00:00Z'),
    })

    expect(url).toBe(RESET_URL)
  })

  it('skips a newer message with no reset link for the newest one that has it', async () => {
    const fetchMock = stubResend([
      {
        id: 'deletion',
        subject: 'Sinu Wobblepoti konto kustutatakse',
        created_at: '2026-08-30 10:06:00.000000+00',
        html: '<a href="https://wobblepot.com/">Wobblepot</a>',
      },
      {
        id: 'older-reset',
        subject: 'Lähtesta oma Wobblepot parool',
        created_at: '2026-08-30 10:01:00.000000+00',
        html: '<a href="http://localhost:3000/api/auth/reset-password/older">go</a>',
      },
      {
        id: 'reset',
        subject: 'Lähtesta oma Wobblepot parool',
        created_at: '2026-08-30 10:05:00.000000+00',
        html: `<a href="${RESET_URL}">go</a>`,
      },
    ])

    const url = await resolveResetUrl({
      email: 'fixture@example.com',
      requestedAt: new Date('2026-08-30T10:00:00Z'),
    })

    expect(url).toBe(RESET_URL)
    // Newest first, and it stops at the first body with a link.
    const detailIds = fetchMock.mock.calls
      .map(([u]) => u)
      .filter((u) => !u.endsWith('/emails'))
      .map((u) => u.split('/').pop())
    expect(detailIds).toEqual(['deletion', 'reset'])
  })

  it('does not accept a reset link sent before the request', async () => {
    stubResend([
      {
        id: 'stale',
        subject: 'Lähtesta oma Wobblepot parool',
        created_at: '2026-08-30 08:00:00.000000+00',
        html: `<a href="${RESET_URL}">go</a>`,
      },
    ])

    const promise = resolveResetUrl({
      email: 'fixture@example.com',
      requestedAt: new Date('2026-08-30T10:00:00Z'),
    })
    await vi.runAllTimersAsync()

    expect(await promise).toBeNull()
  })
})
