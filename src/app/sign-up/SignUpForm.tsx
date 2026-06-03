'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { useAuthErrorMessage } from '@/lib/auth-errors-client'
import { getValidReturnUrl } from '@/lib/utils'
import { track } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

interface SignUpFormProps {
  inviteRequired: boolean
  privateBetaBanner: string
  inviteCodeLabel: string
  inviteCodeHint: string
}

export function SignUpForm({
  inviteRequired,
  privateBetaBanner,
  inviteCodeLabel,
  inviteCodeHint,
}: SignUpFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = getValidReturnUrl(searchParams.get('returnUrl'))
  const t = useTranslations('auth.signUp')
  const friendlyError = useAuthErrorMessage()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSlowRequest, setIsSlowRequest] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    setIsSlowRequest(false)

    // Start timeout detection (10 seconds)
    const timeoutId = setTimeout(() => {
      setIsSlowRequest(true)
    }, 10000)

    try {
      // Better Auth's email signup endpoint forwards unknown body fields to
      // the request-level `hooks.before` middleware (see src/lib/auth.ts).
      // The invite code is consumed there; it must NOT be persisted on the
      // user row, so it is intentionally not in `additionalFields`. The same
      // applies to `acceptedTerms`: the server validates the flag and stamps
      // `acceptedTermsAt` + `acceptedTermsVersion` itself (HON-457).
      const payload: Record<string, unknown> = { email, password, name, acceptedTerms }
      if (inviteRequired) {
        payload.inviteCode = inviteCode
      }
      await authClient.signUp.email(payload as Parameters<typeof authClient.signUp.email>[0], {
        onSuccess: () => {
          // Fire-and-forget analytics; HON-476 wires `auth:sign_up` into the
          // funnel taxonomy. Awaiting would make a slow PostHog request gate
          // the redirect, so we intentionally drop the promise.
          void track('auth:sign_up', {})
          try {
            router.push(returnUrl)
            router.refresh()
          } catch {
            setError(t('navigationFailed'))
          }
        },
        onError: (ctx) => {
          const errorMessage = ctx.error?.message || ''
          setError(friendlyError(errorMessage))
        },
      })
    } catch (err) {
      // Handle exceptions thrown by authClient (e.g., network errors when offline).
      // Non-Error throws are rare but historically mapped to the network copy.
      const errorMessage = err instanceof Error ? err.message : 'network'
      setError(friendlyError(errorMessage))
    } finally {
      clearTimeout(timeoutId)
      setIsLoading(false)
      setIsSlowRequest(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Heading variant="h4">{t('title')}</Heading>
        <Body variant="muted">{t('description')}</Body>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="flex flex-col gap-4">
            {inviteRequired && (
              <div
                className="border-primary/30 bg-primary/5 rounded-md border px-3 py-2"
                role="note"
                aria-label={t('privateBetaNoticeLabel')}
              >
                <Body variant="small">{privateBetaBanner}</Body>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{t('nameLabel')}</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isLoading}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t('passwordLabel')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                minLength={12}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : 'password-hint'}
              />
              <Body id="password-hint" variant="small" className="text-muted-foreground">
                {t('passwordHint')}
              </Body>
            </div>
            {inviteRequired && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="inviteCode">{inviteCodeLabel}</Label>
                <Input
                  id="inviteCode"
                  name="inviteCode"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                  autoComplete="off"
                  disabled={isLoading}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'form-error' : 'invite-code-hint'}
                />
                <Body id="invite-code-hint" variant="small" className="text-muted-foreground">
                  {inviteCodeHint}
                </Body>
              </div>
            )}
            <div className="flex items-start gap-2">
              <Checkbox
                id="acceptTerms"
                checked={acceptedTerms}
                onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                required
                disabled={isLoading}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : undefined}
              />
              <Label htmlFor="acceptTerms" id="consent-label" className="leading-snug font-normal">
                <span>
                  {t.rich('consentLabel', {
                    terms: (chunks) => (
                      <Link
                        href="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {chunks}
                      </Link>
                    ),
                    privacy: (chunks) => (
                      <Link
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              </Label>
            </div>
            {error && (
              <Body id="form-error" variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            )}
            {isSlowRequest && !error && (
              <Body variant="small" className="text-muted-foreground">
                {t('slowRequest')}
              </Body>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !acceptedTerms}
              // Tells screen-reader users *why* the button is disabled while
              // the consent checkbox is unchecked.
              aria-describedby={!acceptedTerms ? 'consent-label' : undefined}
            >
              {isLoading ? t('submitting') : t('submit')}
            </Button>
            <Body variant="small" className="text-muted-foreground text-center">
              {t('alreadyHaveAccount')}{' '}
              <Link
                href={
                  returnUrl !== '/'
                    ? `/sign-in?returnUrl=${encodeURIComponent(returnUrl)}`
                    : '/sign-in'
                }
                className="text-primary hover:underline"
              >
                {t('signInLink')}
              </Link>
            </Body>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
