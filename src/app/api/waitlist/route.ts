import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/request-ip'
import { getServerFlag } from '@/lib/feature-flags'
import { LocaleSchema } from '@/lib/i18n/locales'
import { resolveLocale } from '@/lib/i18n/resolve-locale'
import { normalizeWaitlistEmail, processWaitlistRequest } from '@/lib/waitlist'
import { captureApiError } from '@/lib/errors'

const waitlistRequestSchema = z.object({
  // 254 is the longest address SMTP can deliver to (RFC 5321).
  email: z.string().trim().max(254).pipe(z.email()),
  // The page locale, from `useLocale()`. Anything else falls back to
  // Accept-Language below rather than failing the request.
  locale: LocaleSchema.optional().catch(undefined),
})

/**
 * POST /api/waitlist
 *
 * A visitor without an invite code asks for one (HON-846). Body `{ email, locale? }`.
 *
 * - 400 for an invalid email.
 * - 429 over the `waitlist` rate limit (per IP).
 * - 409 when `invite_code_required` is off: sign-up is open, so there is
 *   nothing to wait for.
 * - 200 `{ ok: true }` otherwise, for every address. The work — the account
 *   check, the upsert, the confirmation email — runs in `after()`, once the
 *   response is sent, so neither the body nor the timing says whether the
 *   address has an account or is already listed.
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null)
    const parsed = waitlistRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }

    const limit = await checkRateLimit(getClientIp(request), 'waitlist')
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds(limit)) } },
      )
    }

    const inviteRequired = await getServerFlag('invite_code_required', 'anonymous')
    if (!inviteRequired) {
      return NextResponse.json({ error: 'Sign-up is open' }, { status: 409 })
    }

    const email = normalizeWaitlistEmail(parsed.data.email)
    const locale =
      parsed.data.locale ??
      resolveLocale({
        householdLocale: null,
        acceptLanguage: request.headers.get('accept-language'),
      })

    after(() => processWaitlistRequest({ email, locale }))

    return NextResponse.json({ ok: true })
  } catch (error) {
    captureApiError(error, { route: '/api/waitlist' })
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
