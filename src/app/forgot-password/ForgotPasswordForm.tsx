'use client'

import { useState } from 'react'
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

export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgotPassword')
  const friendlyError = useAuthErrorMessage()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  // Only a real error refocuses: success replaces the form, button included.
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(isLoading)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setIsLoading(true)

    try {
      await authClient.requestPasswordReset(
        {
          email,
          redirectTo: '/reset-password',
        },
        {
          onSuccess: () => {
            setSuccess(true)
          },
          onError: (ctx: { error: { message?: string } }) => {
            const errorMessage = ctx.error?.message || ''
            const lowerMessage = errorMessage.toLowerCase()

            // Always show success for "user not found" to prevent account enumeration
            if (
              lowerMessage.includes('user not found') ||
              lowerMessage.includes('email not found') ||
              lowerMessage.includes('no user') ||
              lowerMessage.includes('not found')
            ) {
              setSuccess(true)
              return
            }

            // Only show actual errors (network, rate limiting, etc.)
            setError(friendlyError(errorMessage))
            requestRefocus()
          },
        },
      )
    } catch (err) {
      // Non-Error throws are typically network failures (Better Auth surfaces
      // them via Error in normal flow). Map to the network friendly copy.
      const errorMessage = err instanceof Error ? err.message : 'network'
      setError(friendlyError(errorMessage))
      requestRefocus()
    } finally {
      setIsLoading(false)
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
            {success ? (
              <div className="flex flex-col gap-2">
                <Body variant="paragraph" tone="success" role="status" data-testid="form-success">
                  {t('success')}
                </Body>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">{t('emailLabel')}</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isLoading}
                    placeholder={t('emailPlaceholder')}
                  />
                </div>
                {error && <FieldError>{error}</FieldError>}
              </>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            {!success && (
              <Button ref={submitRef} type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t('submitting') : t('submit')}
              </Button>
            )}
            <Body variant="muted" className="text-center">
              {t('rememberPassword')}{' '}
              <Link href="/sign-in" className="text-primary hover:underline">
                {t('signInLink')}
              </Link>
            </Body>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
