'use client'

import { useState, useEffect } from 'react'
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

export function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('auth.resetPassword')
  const tValidation = useTranslations('validation')
  const friendlyError = useAuthErrorMessage()
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Extract token from URL query params
    const tokenParam = searchParams.get('token')
    if (tokenParam) {
      setToken(tokenParam)
    } else {
      setError(tValidation('noResetToken'))
    }
  }, [searchParams, tValidation])

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

    if (!token) {
      setError(tValidation('noResetToken'))
      return
    }

    setIsLoading(true)

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
      setIsLoading(false)
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPassword">{t('newPasswordLabel')}</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={isLoading || !token}
                minLength={12}
                placeholder={t('newPasswordPlaceholder')}
                aria-describedby="password-hint"
              />
              <Body id="password-hint" variant="small" className="text-muted-foreground">
                {t('passwordHint')}
              </Body>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">{t('confirmPasswordLabel')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isLoading || !token}
                minLength={12}
                placeholder={t('confirmPasswordPlaceholder')}
              />
            </div>
            {error && (
              <Body variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading || !token}>
              {isLoading ? t('submitting') : t('submit')}
            </Button>
            <Body variant="small" className="text-muted-foreground text-center">
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
