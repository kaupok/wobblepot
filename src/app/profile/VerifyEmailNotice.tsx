'use client'

import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { ApiError } from '@/lib/api'
import { EMAIL_VERIFICATION_CALLBACK_URL, type VerificationLanding } from '@/lib/email-verification'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

interface VerifyEmailNoticeProps {
  email: string
  emailVerified: boolean
  /** What the verification link's redirect left in the URL, from `parseVerificationLanding`. */
  landing: VerificationLanding | null
}

/** The params Better Auth's verify-email redirect adds to `/profile`. */
const LANDING_PARAMS = ['verified', 'error'] as const

/**
 * The account email's verification state on `/profile` (HON-1155).
 *
 * Unverified: a warning with a Resend button. After an expired or broken link
 * the warning says so. Verified: nothing, except once after the link landed
 * here, when it confirms. The redirect params are cleared from the URL on
 * mount, so a reload does not repeat the message.
 */
export function VerifyEmailNotice({ email, emailVerified, landing }: VerifyEmailNoticeProps) {
  const t = useTranslations('profile.verifyEmail')
  const tErrors = useTranslations('errors.auth')
  const sentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!landing) return
    const url = new URL(window.location.href)
    for (const param of LANDING_PARAMS) url.searchParams.delete(param)
    // Native `replaceState`: the App Router syncs with it, and keeping
    // `history.state` keeps the router's own entry intact.
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [landing])

  const resend = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.sendVerificationEmail({
        email,
        callbackURL: EMAIL_VERIFICATION_CALLBACK_URL,
      })
      if (error) {
        throw new ApiError(error.message ?? '', error.status, { code: error.code })
      }
    },
    onError: (error) => {
      // The server string is English and is logged, not shown (CLAUDE.md → Localization).
      console.error('[verify-email] resend failed', error)
      requestRefocus()
    },
  })
  const { ref: resendRef, requestRefocus } = useRefocusAfterPending(resend.isPending)

  // The Resend button goes away on success, so focus moves to the message
  // that replaced it instead of falling to the page.
  useEffect(() => {
    if (resend.isSuccess) sentRef.current?.focus()
  }, [resend.isSuccess])

  if (emailVerified) {
    if (landing !== 'verified') return null
    return (
      <Callout tone="success" role="status">
        {t('verified')}
      </Callout>
    )
  }

  if (resend.isSuccess) {
    return (
      <div ref={sentRef} tabIndex={-1} className="outline-none">
        <Callout tone="success" role="status">
          {t('sent')}
        </Callout>
      </div>
    )
  }

  const message =
    landing === 'expired' ? t('expired') : landing === 'invalid' ? t('invalid') : t('notVerified')

  return (
    <div className="flex flex-col gap-2">
      <Callout tone="warning" role="status">
        {message}
      </Callout>
      <div>
        <Button
          ref={resendRef}
          type="button"
          variant="outline"
          size="sm"
          disabled={resend.isPending}
          onClick={() => resend.mutate()}
        >
          {resend.isPending ? t('sending') : t('resend')}
        </Button>
      </div>
      {resend.isError && <FieldError>{errorMessage(resend.error)}</FieldError>}
    </div>
  )

  function errorMessage(error: Error): string {
    if (error instanceof ApiError) {
      if (error.status === 429) return tErrors('tooManyAttempts')
      if (error.code === 'EMAIL_ALREADY_VERIFIED') return t('alreadyVerified')
    }
    return t('sendFailed')
  }
}
