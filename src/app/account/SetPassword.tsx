'use client'

import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

/**
 * The password section for an account with no password, only Google
 * (HON-1158). `ChangePasswordForm` asks for the current password, which this
 * account does not have, so it gets Set a password instead: the reset email,
 * whose `/reset-password` creates the password. Better Auth's `setPassword` is
 * server-only by design, so the browser cannot set one directly.
 *
 * The sent message replaces the button, so one click sends one email.
 */
export function SetPassword({ email }: { email: string }) {
  const t = useTranslations('account.password.googleOnly')
  const tErrors = useTranslations('errors.auth')
  const sentRef = useRef<HTMLDivElement>(null)

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password',
      })
      if (error) {
        throw new ApiError(error.message ?? '', error.status, { code: error.code })
      }
    },
    onError: (error) => {
      // The server string is English and is logged, not shown (CLAUDE.md → Localization).
      console.error('[set-password] reset email failed', error)
      requestRefocus()
    },
  })
  const { ref: buttonRef, requestRefocus } = useRefocusAfterPending(send.isPending)

  // The button goes away on success, so focus moves to the message that
  // replaced it instead of falling to the page.
  useEffect(() => {
    if (send.isSuccess) sentRef.current?.focus()
  }, [send.isSuccess])

  if (send.isSuccess) {
    return (
      <div ref={sentRef} tabIndex={-1} className="outline-none">
        <Callout tone="success" role="status">
          {t('sent')}
        </Callout>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          ref={buttonRef}
          type="button"
          variant="outline"
          disabled={send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? t('sending') : t('submit')}
        </Button>
      </div>
      {send.isError && (
        <FieldError>
          {send.error instanceof ApiError && send.error.status === 429
            ? tErrors('tooManyAttempts')
            : t('sendFailed')}
        </FieldError>
      )}
    </div>
  )
}
