/**
 * Reading outbound email from a spec (HON-479).
 *
 * Two backends, in preference order, because no single one works everywhere:
 *
 * 1. **Resend** (`RESEND_TEST_API_KEY`) — `GET /emails` lists what the team
 *    sent, `GET /emails/{id}` returns the rendered `html`. This is the only
 *    option on preview and staging, where the app really does send mail and
 *    no test-only route exists. The key must be a *read-capable* Resend API
 *    key scoped to the same team the app sends from.
 * 2. **Back-channel** (`/api/e2e-support`) — tier 1 CI and local runs have no
 *    `RESEND_API_KEY` at all, so `sendResetPassword` short-circuits and no
 *    email is ever produced. There we read the reset token straight out of
 *    the `Verification` row Better Auth wrote. Same user-visible flow from the
 *    reset link onwards; only the transport is skipped.
 *
 * When neither is available the caller gets `null` and is expected to skip —
 * see `tests/e2e/README.md` § "Reading email in specs".
 */
import { e2eBaseURL } from './db-helpers'
import { fetchResetToken } from './e2e-support'

const RESEND_API = 'https://api.resend.com'

/** Poll budget for Resend: sends are asynchronous, the list is eventually consistent. */
const RESEND_POLL_ATTEMPTS = 10
const RESEND_POLL_INTERVAL_MS = 2_000

export interface ResendEmail {
  id: string
  to: string[]
  subject: string
  created_at: string
}

export interface ResendEmailDetail extends ResendEmail {
  html: string | null
  text: string | null
}

export function resendTestKey(): string | undefined {
  return process.env.RESEND_TEST_API_KEY
}

/** True when a spec can assert on real delivered email. */
export function canReadEmail(): boolean {
  return !!resendTestKey()
}

async function resendGet<T>(path: string): Promise<T> {
  const res = await fetch(`${RESEND_API}${path}`, {
    headers: { authorization: `Bearer ${resendTestKey()}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `[e2e/mail] Resend GET ${path} failed (status ${res.status}): ${body || '<empty>'}. ` +
        `Check RESEND_TEST_API_KEY has read access to the sending team.`,
    )
  }
  return (await res.json()) as T
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Most recent email to `recipient`, sent no earlier than `sentAfter`, that
 * passes every matcher given. Polls, because Resend's list lags the send by a
 * second or two. Returns `null` if nothing matches within the budget, so
 * callers can decide between failing and skipping.
 *
 * Two matchers, at least one required — recipient and send time alone would
 * return whatever that address last received:
 *
 * - `subjectPattern` is checked against the list, so it costs nothing. The
 *   subject is localized (HON-513), so it only suits a spec that pins the
 *   recipient's locale.
 * - `bodyMatches` needs the rendered body, which only `GET /emails/{id}`
 *   returns, so candidates are fetched newest-first until one passes. Prefer
 *   it when a locale-invariant marker exists in the body — a reset link does
 *   (HON-704).
 *
 * The `sentAfter` bound matters on shared tiers: the fixture inbox accumulates
 * mail from every previous run, and matching an older reset link would make
 * the spec pass against a stale token.
 */
export async function findRecentEmail(options: {
  recipient: string
  subjectPattern?: RegExp
  bodyMatches?: (email: ResendEmailDetail) => boolean
  sentAfter: Date
}): Promise<ResendEmailDetail | null> {
  const { recipient, subjectPattern, bodyMatches, sentAfter } = options
  if (!subjectPattern && !bodyMatches) {
    throw new Error('[e2e/mail] findRecentEmail needs a subjectPattern or a bodyMatches predicate')
  }
  const recipientLower = recipient.toLowerCase()
  // A candidate whose body already failed `bodyMatches` can't start passing on
  // a later poll, so don't pay to fetch it again.
  const rejected = new Set<string>()

  for (let attempt = 0; attempt < RESEND_POLL_ATTEMPTS; attempt++) {
    // First page only. Resend returns newest-first and this inbox sees a
    // handful of messages per run, so paging would add failure modes without
    // adding coverage.
    const { data } = await resendGet<{ data: ResendEmail[] }>('/emails')

    const candidates = (data ?? [])
      .filter(
        (email) =>
          !rejected.has(email.id) &&
          email.to?.some((to) => to.toLowerCase() === recipientLower) &&
          (!subjectPattern || subjectPattern.test(email.subject ?? '')) &&
          isAtOrAfter(email.created_at, sentAfter),
      )
      .sort((a, b) => parseResendTimestamp(b.created_at) - parseResendTimestamp(a.created_at))

    for (const candidate of candidates) {
      const detail = await resendGet<ResendEmailDetail>(`/emails/${candidate.id}`)
      if (!bodyMatches || bodyMatches(detail)) {
        return detail
      }
      rejected.add(candidate.id)
    }

    await sleep(RESEND_POLL_INTERVAL_MS)
  }

  return null
}

/**
 * Resend stamps `created_at` as `2026-04-03 22:13:42.674981+00` — a space
 * separator, microsecond precision, and a two-digit offset. `Date.parse`
 * rejects all three, so normalise to ISO-8601 first. Getting this wrong is not
 * loud: it returns `NaN`, and a permissive fallback would quietly drop the
 * freshness bound and let a previous run's reset link satisfy this one.
 */
function parseResendTimestamp(value: string): number {
  const iso = value
    .trim()
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
  return Date.parse(iso)
}

/**
 * An unparseable timestamp excludes the message. Skipping the spec because the
 * date format moved is recoverable; passing it against a stale token is not.
 */
function isAtOrAfter(timestamp: string, bound: Date): boolean {
  const parsed = parseResendTimestamp(timestamp)
  // 1s of slack: `sentAfter` is taken in the runner, `created_at` on Resend.
  return Number.isNaN(parsed) ? false : parsed >= bound.getTime() - 1_000
}

/**
 * Absolute URL the user would click in the reset email.
 *
 * Both backends return Better Auth's `/api/auth/reset-password/:token` link
 * (the mail backend by extracting it, the back-channel by reconstructing it),
 * so the spec always exercises the real token-validation redirect rather than
 * deep-linking straight to `/reset-password?token=`.
 */
export async function resolveResetUrl(options: {
  email: string
  requestedAt: Date
}): Promise<string | null> {
  const { email, requestedAt } = options

  if (canReadEmail()) {
    // Selected by the reset link, never the subject: the subject is localized
    // to the household's locale (HON-513) and the helper can't know which one
    // a fixture resolves to. The Better Auth path is locale-invariant (HON-704).
    const message = await findRecentEmail({
      recipient: email,
      bodyMatches: (detail) => extractResetUrl(emailBody(detail)) !== null,
      sentAfter: requestedAt,
    })
    return message ? extractResetUrl(emailBody(message)) : null
  }

  const payload = await fetchResetToken(email)
  return payload ? `${e2eBaseURL()}${payload.resetPath}` : null
}

function emailBody(email: ResendEmailDetail): string {
  return email.html ?? email.text ?? ''
}

/**
 * Pulls the reset link out of an email body. Anchored on the Better Auth path
 * (`/api/auth/reset-password/<token>`) rather than "the first link", so an
 * unsubscribe or logo href can't be mistaken for it.
 */
export function extractResetUrl(body: string): string | null {
  const match = body.match(/https?:\/\/[^\s"'<>]*\/api\/auth\/reset-password\/[^\s"'<>]+/i)
  if (!match) {
    return null
  }
  // Entity-decode the query separators an HTML body escapes (&amp; → &).
  return match[0].replace(/&amp;/g, '&')
}
