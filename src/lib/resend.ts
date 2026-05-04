import { Resend } from 'resend'
import { clientEnv, serverEnv } from '@/lib/env'

/**
 * Singleton pattern: prevents multiple instances under Next.js hot reload.
 * Returns null when RESEND_API_KEY is unset so CI/builds/local can boot without
 * email being configured — the send-site short-circuits via `isEmailConfigured`.
 *
 * @see https://resend.com/docs/send-with-nodejs
 */
const globalForResend = globalThis as unknown as {
  resend: Resend | null | undefined
}

function createResendClient(): Resend | null {
  const apiKey = serverEnv.RESEND_API_KEY
  if (!apiKey) {
    return null
  }
  return new Resend(apiKey)
}

export const resend = globalForResend.resend ?? createResendClient()

if (process.env.NODE_ENV !== 'production') globalForResend.resend = resend

export function isEmailConfigured(): boolean {
  return resend !== null
}

/**
 * Purpose-specific FROM addresses. All envs share the same sending domain
 * (`mail.wobblepot.com`); env disambiguation lives in the subject prefix via
 * `envSubject`. Rationale + revisit triggers in `docs/EMAIL_SETUP.md`.
 *
 * `support` outbound is intentionally absent: the apex `wobblepot.com` isn't
 * verified in Resend, the provider is undecided (Resend apex / Workspace /
 * Fastmail), and there's no send-site yet. Display address for inbound /
 * mailto: links lives in `src/lib/support.ts` (`SUPPORT_EMAIL`).
 */
export const EMAIL_SENDERS = {
  auth: 'Wobblepot <auth@mail.wobblepot.com>',
  notifications: 'Wobblepot <notifications@mail.wobblepot.com>',
} as const

export type EmailSender = keyof typeof EMAIL_SENDERS

/**
 * Prefixes the subject with `[Staging]` outside production so testers can
 * tell at a glance which env the email came from. Apply at every send-site —
 * we don't have a wrapper around `resend.emails.send` (one send-site today).
 */
export function envSubject(subject: string): string {
  return clientEnv.NEXT_PUBLIC_APP_ENV === 'production' ? subject : `[Staging] ${subject}`
}
