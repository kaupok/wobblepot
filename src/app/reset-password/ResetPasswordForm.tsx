'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { useAuthErrorMessage } from '@/lib/auth-errors-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

export function ResetPasswordForm() {
  const searchParams = useSearchParams()
  // Read during render, not in an effect, so a link without a token never
  // shows the password fields before the message replaces them.
  const token = searchParams.get('token')
  // Better Auth sends an expired or already-used emailed link here as
  // `?error=INVALID_TOKEN`, without a token. That user did open the email.
  const expired = searchParams.get('error') === 'INVALID_TOKEN'

  return token ? <ResetPasswordFields token={token} /> : <MissingLinkCard expired={expired} />
}

// A truncated email link, a bookmark, a URL copied without its query string, or
// an expired link lands here. There is nothing to reset, so offer the one way
// forward.
function MissingLinkCard({ expired }: { expired: boolean }) {
  const t = useTranslations('auth.resetPassword')
  const tErrors = useTranslations('errors.auth')

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Heading as="h1" variant="h4">
          {t('title')}
        </Heading>
      </CardHeader>
      <CardContent>
        <FieldError>{expired ? tErrors('tokenExpired') : t('missingLink')}</FieldError>
      </CardContent>
      <CardFooter className="pt-6">
        <div className="flex w-full flex-col gap-4">
          <Button asChild className="w-full">
            <Link href="/forgot-password">{t('requestNewLink')}</Link>
          </Button>
          <RememberPasswordLine />
        </div>
      </CardFooter>
    </Card>
  )
}

function RememberPasswordLine() {
  const t = useTranslations('auth.resetPassword')

  return (
    <Body variant="muted" className="text-center">
      {t('rememberPassword')}{' '}
      <Link href="/sign-in" className="text-primary hover:underline">
        {t('signInLink')}
      </Link>
    </Body>
  )
}

function ResetPasswordFields({ token }: { token: string }) {
  const router = useRouter()
  const t = useTranslations('auth.resetPassword')
  const tValidation = useTranslations('validation')
  const friendlyError = useAuthErrorMessage()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(isLoading)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError(tValidation('passwordsDoNotMatch'))
      return
    }

    // Validate password length
    if (newPassword.length < 12) {
      setError(tValidation('passwordTooShort'))
      return
    }

    setIsLoading(true)

    // The auth promise resolves as soon as the server answers, but the
    // router.push in onSuccess still has to fetch and render the new route.
    // Keep the form disabled once navigation has started and let the unmount
    // clear it; otherwise the button flickers back to enabled for a beat.
    let isNavigating = false

    try {
      await authClient.resetPassword(
        {
          newPassword,
          token,
        },
        {
          onSuccess: () => {
            // Redirect to sign-in page with success message
            router.push('/sign-in?reset=success')
            isNavigating = true
          },
          onError: (ctx) => {
            const errorMessage = ctx.error?.message || ''
            setError(friendlyError(errorMessage))
          },
        },
      )
    } catch (err) {
      // Non-Error throws are rare but historically mapped to the network copy.
      const errorMessage = err instanceof Error ? err.message : 'network'
      setError(friendlyError(errorMessage))
    } finally {
      if (!isNavigating) {
        // Every exit that did not navigate is a failure: return focus to the
        // submit button, which lost it when the form was disabled.
        requestRefocus()
        setIsLoading(false)
      }
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Heading as="h1" variant="h4">
          {t('title')}
        </Heading>
        <Body variant="muted">{t('description')}</Body>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPassword">{t('newPasswordLabel')}</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={isLoading}
                minLength={12}
                maxLength={128}
                aria-describedby="password-hint"
              />
              <Body id="password-hint" variant="muted">
                {t('passwordHint')}
              </Body>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">{t('confirmPasswordLabel')}</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isLoading}
                minLength={12}
                maxLength={128}
              />
            </div>
            {error && <FieldError>{error}</FieldError>}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            <Button ref={submitRef} type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t('submitting') : t('submit')}
            </Button>
            <RememberPasswordLine />
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
