'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { ApiError } from '@/lib/api'
import { CHANGE_EMAIL_CALLBACK_URL, type ChangeEmailLanding } from '@/lib/email-verification'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'
import { useClearLandingParams } from '@/hooks/use-clear-landing-params'

/** The params the email-change link's redirect adds to `/account`. */
const LANDING_PARAMS = ['emailChanged', 'error'] as const

/** A light shape check; the server validates the address again. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ChangeEmailFormProps {
  /** The account email now. */
  email: string
  /** What the email-change link's redirect left in the URL, from `parseChangeEmailLanding`. */
  landing: ChangeEmailLanding | null
}

/**
 * The account email on `/account`, with a change (HON-1137). Only an account
 * with a password shows it: Google owns a Google-only account's address.
 *
 * Submitting sends a link to the new address and changes nothing yet; the
 * change applies when the link is opened. An address that another account
 * uses gets the same answer, so the form does not tell who has an account.
 * After the link, the redirect lands here with `?emailChanged=1`, or with
 * `&error=…`, and the params are cleared so a reload does not repeat it.
 */
export function ChangeEmailForm({ email, landing }: ChangeEmailFormProps) {
  const t = useTranslations('account.changeEmail')
  const tAccount = useTranslations('account')
  const tErrors = useTranslations('errors.auth')
  const [value, setValue] = useState(email)
  const [inputError, setInputError] = useState('')

  useClearLandingParams(Boolean(landing), LANDING_PARAMS)

  const change = useMutation({
    mutationFn: async (newEmail: string) => {
      const { error } = await authClient.changeEmail({
        newEmail,
        callbackURL: CHANGE_EMAIL_CALLBACK_URL,
      })
      if (error) {
        throw new ApiError(error.message ?? '', error.status, { code: error.code })
      }
      return newEmail
    },
    onSuccess: () => {
      // The stored address has not changed yet, so the field shows it again.
      setValue(email)
      requestRefocus()
    },
    onError: (error) => {
      // The server string is English and is logged, not shown (CLAUDE.md → Localization).
      console.error('[change-email] request failed', error)
      requestRefocus()
    },
  })
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(change.isPending)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setInputError('')
    change.reset()

    const newEmail = value.trim().toLowerCase()
    if (!newEmail) {
      setInputError(t('required'))
      return
    }
    if (!EMAIL_SHAPE.test(newEmail)) {
      setInputError(t('invalid'))
      return
    }
    // Better Auth answers a same-address request with an English 400.
    if (newEmail === email.toLowerCase()) {
      setInputError(t('same'))
      return
    }
    change.mutate(newEmail)
  }

  const error = inputError || (change.isError ? errorMessage(change.error) : '')
  // A landing message stays until the user sends another request.
  const showLanding = landing && change.isIdle && !inputError

  return (
    // `noValidate`: a bad address shows catalog copy, not the browser's bubble.
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="accountEmail">{tAccount('emailLabel')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <Input
              id="accountEmail"
              name="email"
              type="email"
              autoComplete="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              disabled={change.isPending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'account-email-error' : undefined}
            />
          </div>
          <Button ref={submitRef} type="submit" variant="outline" disabled={change.isPending}>
            {change.isPending ? t('sending') : t('submit')}
          </Button>
        </div>
        {error && <FieldError id="account-email-error">{error}</FieldError>}
        {change.isSuccess && (
          <Callout tone="success" role="status">
            {t('sent', { email: change.data })}
          </Callout>
        )}
        {showLanding && (
          <Callout tone={landing === 'changed' ? 'success' : 'warning'} role="status">
            {landing === 'changed'
              ? t('changed', { email })
              : landing === 'expired'
                ? t('expired')
                : t('linkInvalid')}
          </Callout>
        )}
      </div>
    </form>
  )

  function errorMessage(error: Error): string {
    if (error instanceof ApiError && error.status === 429) return tErrors('tooManyAttempts')
    return t('sendFailed')
  }
}
