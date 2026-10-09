'use client'

import { useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { useAuthErrorMessage } from '@/lib/auth-errors-client'
import { getValidReturnUrl } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { householdInvitePath } from '@/lib/household-invite-link'
import { track } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

/** A valid household invite the visitor came from (HON-1131). */
export interface SignUpHouseholdInvite {
  code: string
  householdName: string
}

interface SignUpFormProps {
  inviteRequired: boolean
  inviteCodeLabel: string
  inviteCodeHint: string
  /**
   * Set when the visit carries a valid household invite. The invite stands in
   * for the sign-up code, so the code field is hidden, and the sign-up joins
   * the household (`afterEmailSignUp` in `src/lib/auth.ts`).
   */
  householdInvite?: SignUpHouseholdInvite | null
}

/**
 * Where an invite-link sign-up goes next. The after-hook's claim never fails
 * the sign-up, so a lost race (another sign-up on the same link) still returns
 * success: ask for the membership to tell the two apart. Joined → `/`, the
 * inviter's meal plan, not onboarding. Not joined → the invite page, which
 * shows why.
 */
async function householdInviteDestination(code: string): Promise<string> {
  try {
    await apiFetch('/api/households/me')
    return '/'
  } catch {
    return householdInvitePath(code)
  }
}

export function SignUpForm({
  inviteRequired,
  inviteCodeLabel,
  inviteCodeHint,
  householdInvite = null,
}: SignUpFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = getValidReturnUrl(searchParams.get('returnUrl'))
  const t = useTranslations('auth.signUp')
  const tErrors = useTranslations('errors.auth')
  const friendlyError = useAuthErrorMessage()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [consentError, setConsentError] = useState(false)
  const consentRef = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSlowRequest, setIsSlowRequest] = useState(false)
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(isLoading)
  // An invitee who has an account after all signs in and comes back to the
  // invite, wherever they entered sign-up from.
  const signInReturnUrl = householdInvite ? householdInvitePath(householdInvite.code) : returnUrl
  const signInHref =
    signInReturnUrl !== '/'
      ? `/sign-in?returnUrl=${encodeURIComponent(signInReturnUrl)}`
      : '/sign-in'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Consent is checked here rather than by disabling the button (HON-848):
    // a disabled button takes no click, so it cannot say what is missing.
    // The server still refuses a sign-up without it (assertTermsAccepted).
    if (!acceptedTerms) {
      setConsentError(true)
      consentRef.current?.focus()
      return
    }
    setError('')
    setIsLoading(true)
    setIsSlowRequest(false)

    // Start timeout detection (10 seconds)
    const timeoutId = setTimeout(() => {
      setIsSlowRequest(true)
    }, 10000)

    // The auth promise resolves as soon as the server answers, but the
    // router.push in onSuccess still has to fetch and render the new route.
    // Keep the form disabled once navigation has started and let the unmount
    // clear it; otherwise the button flickers back to enabled for a beat.
    let isNavigating = false

    try {
      // Better Auth's email signup endpoint forwards unknown body fields to
      // the request-level `hooks.before` middleware (see src/lib/auth.ts).
      // The invite code is consumed there; it must NOT be persisted on the
      // user row, so it is intentionally not in `additionalFields`. The same
      // applies to `acceptedTerms`: the server validates the flag and stamps
      // `acceptedTermsAt` + `acceptedTermsVersion` itself (HON-457).
      // A household invite replaces the sign-up code: the before-hook checks
      // it, and the after-hook joins the household (HON-1131).
      const payload: Record<string, unknown> = { email, password, name, acceptedTerms }
      if (householdInvite) {
        payload.householdInviteCode = householdInvite.code
      } else if (inviteRequired) {
        payload.inviteCode = inviteCode
      }
      await authClient.signUp.email(payload as Parameters<typeof authClient.signUp.email>[0], {
        onSuccess: async () => {
          // Fire-and-forget analytics; HON-476 wires `auth:sign_up` into the
          // funnel taxonomy. Awaiting would make a slow PostHog request gate
          // the redirect, so we intentionally drop the promise.
          void track('auth:sign_up', {})
          const destination = householdInvite
            ? await householdInviteDestination(householdInvite.code)
            : returnUrl
          try {
            router.push(destination)
            router.refresh()
            isNavigating = true
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
      if (!isNavigating) {
        // Every exit that did not navigate is a failure: return focus to the
        // submit button, which lost it when the form was disabled.
        requestRefocus()
        setIsLoading(false)
        setIsSlowRequest(false)
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
            {householdInvite ? (
              <Callout role="note" aria-label={t('householdInviteLabel')}>
                {t.rich('householdInvite', {
                  householdName: householdInvite.householdName,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </Callout>
            ) : (
              inviteRequired && (
                <Callout role="note" aria-label={t('privateBetaNoticeLabel')}>
                  {t('privateBetaBanner')}{' '}
                  {t.rich('requestInvite', {
                    link: (chunks) => (
                      <Link href="/request-invite" className="underline">
                        {chunks}
                      </Link>
                    ),
                  })}
                </Callout>
              )
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{t('nameLabel')}</Label>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
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
                name="email"
                type="email"
                autoComplete="email"
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
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                minLength={12}
                maxLength={128}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : 'password-hint'}
              />
              <Body id="password-hint" variant="muted">
                {t('passwordHint')}
              </Body>
            </div>
            {inviteRequired && !householdInvite && (
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
                <Body id="invite-code-hint" variant="muted">
                  {inviteCodeHint}
                </Body>
              </div>
            )}
            <div className="flex items-start gap-2">
              <Checkbox
                ref={consentRef}
                id="acceptTerms"
                checked={acceptedTerms}
                onCheckedChange={(checked) => {
                  setAcceptedTerms(checked === true)
                  if (checked === true) setConsentError(false)
                }}
                // Not `required`: Radix would render a hidden native input whose
                // browser validation blocks the submit before handleSubmit can
                // show the consent error, anchored to an input nobody can see.
                aria-required="true"
                disabled={isLoading}
                aria-invalid={consentError || !!error}
                aria-describedby={consentError ? 'consent-error' : error ? 'form-error' : undefined}
              />
              <Label htmlFor="acceptTerms" className="font-normal">
                {/* A multi-line consent label: Label is `leading-none`, which
                    would crowd the wrapped lines. The span is a flex item, so
                    its own line-height applies. */}
                <span className="leading-snug">
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
            {consentError && (
              <FieldError id="consent-error">{tErrors('termsNotAccepted')}</FieldError>
            )}
            {error && <FieldError id="form-error">{error}</FieldError>}
            {isSlowRequest && !error && <Body variant="muted">{t('slowRequest')}</Body>}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            <Button ref={submitRef} type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t('submitting') : t('submit')}
            </Button>
            <Body variant="muted" className="text-center">
              {t('alreadyHaveAccount')}{' '}
              <Link href={signInHref} className="text-primary hover:underline">
                {t('signInLink')}
              </Link>
            </Body>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
