'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { getAuthErrorKey } from '@/lib/auth-errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

const MIN_PASSWORD_LENGTH = 12

/**
 * Changes the password of the signed-in user. `revokeOtherSessions` signs out
 * every other device; Better Auth replaces this device's session cookie, so the
 * user stays signed in here (HON-1129).
 */
export function ChangePasswordForm() {
  const t = useTranslations('profile.password')
  const tSignUp = useTranslations('auth.signUp')
  const tValidation = useTranslations('validation')
  const tErrors = useTranslations('errors.auth')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(isLoading)

  // Catalog copy only: an unmapped server string is English, so it is logged,
  // not shown (CLAUDE.md → Localization). `useAuthErrorMessage` would render it.
  const showServerError = (message: string) => {
    console.error('[change-password] request failed', message)
    const key = getAuthErrorKey(message)
    setError(key ? tErrors(key) : tErrors('unexpected'))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // The form is `noValidate`, so these checks show catalog copy instead of
    // the browser's own bubble.
    if (!currentPassword) {
      setError(t('currentRequired'))
      return
    }

    if (newPassword !== confirmPassword) {
      setError(tValidation('passwordsDoNotMatch'))
      return
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(tValidation('passwordTooShort'))
      return
    }

    setIsLoading(true)
    let changed = false

    try {
      const { error: serverError } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (serverError) {
        showServerError(serverError.message ?? '')
      } else {
        changed = true
      }
    } catch (err) {
      // Non-Error throws are rare but historically mapped to the network copy.
      showServerError(err instanceof Error ? err.message : 'network')
    }

    if (changed) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success(t('success'))
    } else {
      // The button lost focus when the form was disabled; give it back.
      requestRefocus()
    }
    setIsLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="currentPassword">{t('currentLabel')}</Label>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            disabled={isLoading}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="newPassword">{t('newLabel')}</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            disabled={isLoading}
            minLength={MIN_PASSWORD_LENGTH}
            aria-describedby="new-password-hint"
          />
          <Body id="new-password-hint" variant="muted">
            {tSignUp('passwordHint')}
          </Body>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmNewPassword">{t('confirmLabel')}</Label>
          <Input
            id="confirmNewPassword"
            name="confirmNewPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={isLoading}
            minLength={MIN_PASSWORD_LENGTH}
          />
        </div>
        {error && <FieldError>{error}</FieldError>}
        <div>
          <Button ref={submitRef} type="submit" disabled={isLoading}>
            {isLoading ? t('submitting') : t('submit')}
          </Button>
        </div>
      </div>
    </form>
  )
}
