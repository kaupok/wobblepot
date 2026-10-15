'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { useAuthErrorMessage } from '@/lib/auth-errors-client'
import { getOAuthErrorKey } from '@/lib/auth-errors'
import { getValidReturnUrl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import {
  AuthMethodDivider,
  GoogleSignInButton,
  googleErrorCallbackURL,
} from '@/components/auth/GoogleSignInButton'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

/**
 * True when sign-in returned `{ redirect: true, url }`. A plain sign-in
 * returns `redirect: false`; the OAuth provider's after-hook replaces the body
 * with the authorization's next URL.
 */
function isOAuthRedirect(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const { redirect, url } = data as { redirect?: unknown; url?: unknown }
  return redirect === true && typeof url === 'string' && url.length > 0
}

interface SignInFormProps {
  /**
   * The URL carries a signed OAuth query: an MCP client is connecting
   * (HON-1150). Sign-up does not carry the query through, so the form tells a
   * new user to set up first and connect again (HON-1162).
   */
  isOAuthRequest?: boolean
  /**
   * Google sign-in is configured (`isGoogleAuthConfigured()`, HON-1157): show
   * Continue with Google under the form.
   */
  googleEnabled?: boolean
}

export function SignInForm({ isOAuthRequest = false, googleEnabled = false }: SignInFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = getValidReturnUrl(searchParams.get('returnUrl'))
  const t = useTranslations('auth.signIn')
  const tErrors = useTranslations('errors.auth')
  const friendlyError = useAuthErrorMessage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSlowRequest, setIsSlowRequest] = useState(false)
  const [isGooglePending, setIsGooglePending] = useState(false)
  // `signup_disabled`: the error names a missing account, so it links to sign-up.
  const [showSignUpLink, setShowSignUpLink] = useState(false)
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(isLoading)
  const { ref: googleRef, requestRefocus: requestGoogleRefocus } =
    useRefocusAfterPending(isGooglePending)
  const signUpHref =
    returnUrl !== '/' ? `/sign-up?returnUrl=${encodeURIComponent(returnUrl)}` : '/sign-up'

  useEffect(() => {
    // Check for password reset success
    const resetSuccess = searchParams.get('reset')
    if (resetSuccess === 'success') {
      setSuccessMessage(t('resetSuccess'))
      // Clear the reset parameter while preserving other params (like returnUrl)
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.delete('reset')
      const newUrl = newParams.toString() ? `/sign-in?${newParams.toString()}` : '/sign-in'
      router.replace(newUrl)
    }
  }, [searchParams, router, t])

  useEffect(() => {
    // A failed Google attempt comes back here with `?error=<code>` (HON-1157).
    // Show its copy, then drop the code so a reload does not show it again.
    const code = searchParams.get('error')
    if (code === null) return
    const key = getOAuthErrorKey(code)
    setError(tErrors(key))
    setShowSignUpLink(key === 'googleNoAccount')
    router.replace(googleErrorCallbackURL('/sign-in', searchParams))
  }, [searchParams, router, tErrors])

  const handleGoogle = async () => {
    setError('')
    setShowSignUpLink(false)
    setIsGooglePending(true)
    let isRedirecting = false
    try {
      // No `requestSignUp`: with `disableImplicitSignUp` this can only reach
      // an existing account, so the sign-in page never creates one. The OAuth
      // provider client plugin adds the signed `oauth_query` of an MCP
      // client connecting (HON-1150) to this POST, and the server resumes the
      // authorization after Google's callback.
      const { error: signInError } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: returnUrl,
        errorCallbackURL: googleErrorCallbackURL('/sign-in', searchParams),
      })
      if (signInError) {
        setError(friendlyError(signInError.message || ''))
      } else {
        // The auth client is already sending the browser to Google.
        isRedirecting = true
      }
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : 'network'))
    } finally {
      if (!isRedirecting) {
        requestGoogleRefocus()
        setIsGooglePending(false)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setShowSignUpLink(false)
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
      await authClient.signIn.email(
        {
          email,
          password,
        },
        {
          onSuccess: (ctx) => {
            // Inside an OAuth authorization (an MCP client connecting,
            // HON-1150) the server answers with the next step, usually
            // `/consent`, and the auth client's redirect plugin has already
            // set `window.location.href` to it. Pushing `returnUrl` here would
            // race that navigation.
            if (isOAuthRedirect(ctx.data)) {
              isNavigating = true
              return
            }
            try {
              router.push(returnUrl)
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
        },
      )
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
            {successMessage && (
              <Body variant="paragraph" tone="success" role="status" data-testid="form-success">
                {successMessage}
              </Body>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (successMessage) setSuccessMessage('')
                }}
                required
                disabled={isLoading}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('passwordLabel')}</Label>
                <Link
                  href="/forgot-password"
                  className="text-primary inline-link text-sm"
                  tabIndex={-1}
                >
                  {t('forgotPasswordLink')}
                </Link>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (successMessage) setSuccessMessage('')
                }}
                required
                disabled={isLoading}
                minLength={8}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
            {error && (
              <FieldError id="form-error">
                {error}
                {showSignUpLink && (
                  <>
                    {' '}
                    <Link href={signUpHref} className="inline-link">
                      {t('googleNoAccountSignUp')}
                    </Link>
                  </>
                )}
              </FieldError>
            )}
            {isSlowRequest && !error && <Body variant="muted">{t('slowRequest')}</Body>}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            <Button
              ref={submitRef}
              type="submit"
              className="w-full"
              disabled={isLoading || isGooglePending}
            >
              {isLoading ? t('submitting') : t('submit')}
            </Button>
            {googleEnabled && (
              <>
                <AuthMethodDivider />
                <GoogleSignInButton
                  ref={googleRef}
                  onClick={handleGoogle}
                  pending={isGooglePending}
                  disabled={isLoading}
                />
              </>
            )}
            <Body variant="muted" className="text-center">
              {t('dontHaveAccount')}{' '}
              <Link href={signUpHref} className="text-primary inline-link">
                {t('signUpLink')}
              </Link>
            </Body>
            {isOAuthRequest && (
              <Body variant="muted" className="text-center">
                {t('connectorSignUpNote')}
              </Body>
            )}
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
