'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { useAuthErrorMessage } from '@/lib/auth-errors-client'
import { getValidReturnUrl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

export function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = getValidReturnUrl(searchParams.get('returnUrl'))
  const t = useTranslations('auth.signIn')
  const friendlyError = useAuthErrorMessage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSlowRequest, setIsSlowRequest] = useState(false)

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
      await authClient.signIn.email(
        {
          email,
          password,
        },
        {
          onSuccess: () => {
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
        },
      )
    } catch (err) {
      // Handle exceptions thrown by authClient (e.g., network errors when offline)
      const errorMessage = err instanceof Error ? err.message : ''
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
            {successMessage && (
              <Body variant="small" className="text-green-600" role="status">
                {successMessage}
              </Body>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              <Input
                id="email"
                type="email"
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
                  className="text-primary text-sm hover:underline"
                  tabIndex={-1}
                >
                  {t('forgotPasswordLink')}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
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
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t('submitting') : t('submit')}
            </Button>
            <Body variant="small" className="text-muted-foreground text-center">
              {t('dontHaveAccount')}{' '}
              <Link
                href={
                  returnUrl !== '/'
                    ? `/sign-up?returnUrl=${encodeURIComponent(returnUrl)}`
                    : '/sign-up'
                }
                className="text-primary hover:underline"
              >
                {t('signUpLink')}
              </Link>
            </Body>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
