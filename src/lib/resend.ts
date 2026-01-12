import { Resend } from 'resend'
import { serverEnv } from '@/lib/env'

/**
 * Resend Client Singleton
 *
 * This pattern prevents multiple instances of Resend client in development
 * due to Next.js hot reloading. In production, a single instance is created.
 *
 * Returns null if RESEND_API_KEY is not configured, allowing graceful
 * degradation in environments where email is not needed (CI, builds).
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

/**
 * Check if email sending is configured
 */
export function isEmailConfigured(): boolean {
  return resend !== null && !!serverEnv.RESEND_FROM_EMAIL
}
